// GET    /api/day?date=DDMMYYYY[&ns=run][&office=BANGKOK]            → { meta, metaAt, people:[records], savedAt }  (or {} if none)
// GET    /api/day?…&manifest=1                                          → { meta, metaAt, savedAt, entries:{id:{updatedAt,order}} } — cheap change check
// GET    /api/day?…&person=<id>                                         → one person record
// PUT    /api/day?date=…&office=…  body = { v:2, meta?, metaAt?, people?, bases?, deleted?, known? } → MERGE into the board
//        → { ok, people:[merged records as stored], rejected:[ids], meta, metaAt, savedAt }
// DELETE /api/day?date=…&office=…                                       → delete the whole board (records + files)
//
// Storage (per board = <ns>/<day>/<office>/):
//   manifest.json            { meta, metaAt, savedAt, entries: { [personId]: { updatedAt, order } } }
//   people/<personId>.json   one record per person — fields, flags, file refs, updatedAt
//                            (a deleted person leaves a tombstone { id, tombstone:true, deletedAt })
//   <personId>/<file>        uploaded documents and generated outputs
//   index.json               older boards only (marked migrated:true once read)
//
// Why this shape. The board used to be one index.json holding the whole list,
// saved from the client after every change: two devices on the same board each
// wrote the list they had and the last writer silently dropped everyone the
// other had added (that lost a morning's customers on 10/11/2026). Now:
//   • each person is their own blob, so two devices adding people never collide;
//   • a save carries only the people changed on that device, plus the record
//     each edit was based on (`bases`): when the server copy moved on meanwhile,
//     the two are merged field by field — only the fields this device actually
//     changed are taken, everything else keeps the other device's value — so
//     one phone ticking "arrived" and the other typing an amount both stick;
//   • versions (updatedAt) are assigned by the server, never by phone clocks;
//   • nobody is removed unless the save says so (`deleted`), and a deletion
//     leaves a tombstone so a stale edit cannot bring the person back;
//   • the manifest is just a directory (ids + updatedAt) so a board can be
//     opened and re-synced WITHOUT list(): on the Hobby plan list() and put()
//     share a 2,000/month budget, so the hot path must not list. If two saves
//     race on the manifest the loser's id can be missing for a moment — the
//     client sends every id it knows (`known`) with each save, so the next
//     save from either device repairs it; the record itself was never at risk.
import { NextRequest, NextResponse } from "next/server";
import { blobDelete, blobGetJson, blobList, blobPut } from "@/lib/blob";

export const runtime = "nodejs";

type PersonRec = { id: string; order: number; updatedAt?: string; fields?: Record<string, unknown>; tombstone?: boolean; deletedAt?: string; [k: string]: unknown };
type Manifest = { meta?: Record<string, unknown>; metaAt?: string; savedAt: string; entries: Record<string, { updatedAt: string; order: number }> };
type SaveBody = { v?: number; meta?: Record<string, unknown>; metaAt?: string; people?: PersonRec[]; bases?: Record<string, PersonRec>; deleted?: string[]; known?: string[] };
type OldIndex = { meta?: Record<string, unknown>; people?: PersonRec[]; savedAt?: string; migrated?: boolean };

function nsOf(req: NextRequest): string {
  return req.nextUrl.searchParams.get("ns") === "run" ? "run" : "days";
}
function dayKey(req: NextRequest): string | null {
  const d = req.nextUrl.searchParams.get("date") ?? "";
  return /^\d{8}$/.test(d) ? d : null;
}
function officeOf(req: NextRequest): string | null {
  const o = req.nextUrl.searchParams.get("office") ?? "";
  return /^[A-Z][A-Z0-9_]{1,30}$/.test(o) ? o : null;
}
function folderOf(req: NextRequest, day: string): string {
  const o = officeOf(req);
  return o ? `${nsOf(req)}/${day}/${o}/` : `${nsOf(req)}/${day}/`;
}
const safeId = (id: unknown) => typeof id === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(id) && id !== "people" ? id : null;
const recPath = (folder: string, id: string) => `${folder}people/${id}.json`;

// Server-side version stamp: ISO time, strictly greater than anything this
// instance handed out before and than `notBefore` (the board's previous
// version), so ordering never depends on a phone's clock.
let lastStamp = "";
function stamp(notBefore = ""): string {
  const floor = lastStamp > notBefore ? lastStamp : notBefore;
  let t = Date.now();
  const floorT = floor ? new Date(floor).getTime() : 0;
  if (Number.isFinite(floorT) && t <= floorT) t = floorT + 1;
  const s = new Date(t).toISOString();
  lastStamp = s;
  return s;
}

async function readManifest(folder: string): Promise<Manifest | null> {
  return blobGetJson<Manifest>(`${folder}manifest.json`);
}
async function writeManifest(folder: string, m: Manifest): Promise<void> {
  await blobPut(`${folder}manifest.json`, JSON.stringify(m), "application/json");
}
async function readRecords(folder: string, ids: string[]): Promise<PersonRec[]> {
  const recs = await Promise.all(ids.map((id) => blobGetJson<PersonRec>(recPath(folder, id))));
  return recs.filter((p): p is PersonRec => !!p && !!safeId(p.id) && !p.tombstone);
}

// Three-way merge of one person: start from the server copy, apply only the
// changes this device made relative to the record it loaded (`base`).
// Top-level keys and `fields.*` are merged independently.
function merge(cur: PersonRec, incoming: PersonRec, base: PersonRec | undefined): PersonRec {
  if (!base) return { ...incoming, order: cur.order ?? incoming.order };  // no base: this device's copy wins whole
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const out: PersonRec = { ...cur };
  for (const k of new Set([...Object.keys(incoming), ...Object.keys(base)])) {
    if (k === "fields" || k === "updatedAt" || k === "id") continue;
    if (!same(incoming[k], base[k])) out[k] = incoming[k];
  }
  const f: Record<string, unknown> = { ...(cur.fields ?? {}) };
  const inF = incoming.fields ?? {}, baseF = base.fields ?? {};
  for (const k of new Set([...Object.keys(inF), ...Object.keys(baseF)])) {
    if (!same(inF[k], baseF[k])) f[k] = inF[k];
  }
  out.fields = f;
  return out;
}

// One-time migrations, each only on a board that has no manifest yet:
//  a) records already exist under people/ (an interim layout) → list once, build the manifest
//  b) index.json with the full list (older layout) → write records + manifest
//  c) pre-office-split <ns>/<day>/index.json saved under this office → same as (b)
// The source index is then marked migrated:true so clearing the board later cannot resurrect it.
async function migrate(req: NextRequest, folder: string, day: string): Promise<Manifest | null> {
  const recBlobs = await blobList(`${folder}people/`);
  const recs = recBlobs.filter((b) => /\/people\/[A-Za-z0-9_.-]+\.json$/.test(b.pathname));
  if (recs.length) {
    const people = (await Promise.all(recs.map((b) => blobGetJson<PersonRec>(b.pathname)))).filter((p): p is PersonRec => !!p && !!safeId(p.id) && !p.tombstone);
    const meta = (await blobGetJson<Record<string, unknown>>(`${folder}meta.json`)) ?? undefined;
    const s = stamp();
    const m: Manifest = { meta, metaAt: meta ? s : undefined, savedAt: s, entries: {} };
    for (const p of people) m.entries[p.id] = { updatedAt: p.updatedAt ?? s, order: p.order ?? 0 };
    await writeManifest(folder, m);
    return m;
  }
  let srcPath = `${folder}index.json`;
  let idx = await blobGetJson<OldIndex>(srcPath);
  const office = officeOf(req);
  if ((!idx || idx.migrated) && office) {
    const legacyPath = `${nsOf(req)}/${day}/index.json`;
    const legacy = await blobGetJson<OldIndex>(legacyPath);
    if (legacy && !legacy.migrated && ((legacy.meta?.office as string | undefined) ?? "") === office) { idx = legacy; srcPath = legacyPath; }
  }
  if (!idx || idx.migrated || (!idx.people?.length && !idx.meta)) return null;
  const s = stamp(idx.savedAt ?? "");
  const m: Manifest = { meta: idx.meta, metaAt: idx.meta ? s : undefined, savedAt: s, entries: {} };
  await Promise.all((idx.people ?? []).map(async (p) => {
    const id = safeId(p.id);
    if (!id) return;
    await blobPut(recPath(folder, id), JSON.stringify({ ...p, id, updatedAt: s }), "application/json");
    m.entries[id] = { updatedAt: s, order: p.order ?? 0 };
  }));
  await writeManifest(folder, m);
  await blobPut(srcPath, JSON.stringify({ ...idx, migrated: true, migratedTo: folder, migratedAt: s }), "application/json");
  return m;
}

export async function GET(req: NextRequest) {
  const day = dayKey(req);
  if (!day) return NextResponse.json({ error: "date=DDMMYYYY required" }, { status: 400 });
  const noStore = { headers: { "Cache-Control": "no-store" } };
  try {
    const folder = folderOf(req, day);
    const one = req.nextUrl.searchParams.get("person");
    if (one) {
      const id = safeId(one);
      const rec = id ? await blobGetJson<PersonRec>(recPath(folder, id)) : null;
      return rec && !rec.tombstone ? NextResponse.json(rec, noStore) : NextResponse.json({ error: "not found" }, { status: 404, ...noStore });
    }
    let m = await readManifest(folder);
    if (!m) m = await migrate(req, folder, day);
    if (!m) return NextResponse.json({}, noStore);
    if (req.nextUrl.searchParams.get("manifest") === "1") return NextResponse.json(m, noStore);
    const people = await readRecords(folder, Object.keys(m.entries));
    people.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return NextResponse.json({ meta: m.meta, metaAt: m.metaAt, people, savedAt: m.savedAt }, noStore);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "read failed" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const day = dayKey(req);
  if (!day) return NextResponse.json({ error: "date=DDMMYYYY required" }, { status: 400 });
  try {
    const text = await req.text();
    if (text.length > 4_000_000) return NextResponse.json({ error: "payload too large" }, { status: 413 });
    const body = JSON.parse(text) as SaveBody;
    // a tab still running the old full-list client must not write: reload it
    if (body.v !== 2) return NextResponse.json({ error: "หน้าเว็บเป็นเวอร์ชันเก่า — รีเฟรชหน้า 1 ครั้งแล้วลองใหม่" }, { status: 409 });
    const folder = folderOf(req, day);
    const m: Manifest = (await readManifest(folder)) ?? (await migrate(req, folder, day)) ?? { savedAt: stamp(), entries: {} };
    const deleted = new Set((body.deleted ?? []).map(safeId).filter((x): x is string => !!x));
    const out: PersonRec[] = [];
    const rejected: string[] = [];

    for (const p of body.people ?? []) {
      const id = safeId(p.id);
      if (!id || deleted.has(id)) continue;
      const entry = m.entries[id];
      const base = body.bases?.[id];
      const cur = await blobGetJson<PersonRec>(recPath(folder, id));
      if (cur?.tombstone && (!base || (cur.deletedAt ?? "") > (base.updatedAt ?? ""))) {
        // deleted on another device after this edit's base was loaded: do not bring the person back
        rejected.push(id);
        continue;
      }
      const untouched = !cur || cur.tombstone || !entry || (base?.updatedAt && base.updatedAt === cur.updatedAt);
      let next: PersonRec = untouched ? { ...p, id } : merge(cur!, { ...p, id }, base);
      const s = stamp(entry?.updatedAt ?? "");
      next = { ...next, updatedAt: s };
      delete next.tombstone; delete next.deletedAt;
      await blobPut(recPath(folder, id), JSON.stringify(next), "application/json");
      m.entries[id] = { updatedAt: s, order: next.order ?? cur?.order ?? 0 };
      out.push(next);
    }
    // ids this client knows about: repairs a manifest entry lost to a racing save
    for (const k of body.known ?? []) {
      const id = safeId(k);
      if (id && !m.entries[id] && !deleted.has(id)) {
        const rec = await blobGetJson<PersonRec>(recPath(folder, id));
        if (rec && !rec.tombstone) m.entries[id] = { updatedAt: rec.updatedAt ?? m.savedAt, order: rec.order ?? 0 };
      }
    }
    for (const id of deleted) {
      delete m.entries[id];
      await blobPut(recPath(folder, id), JSON.stringify({ id, tombstone: true, deletedAt: stamp() }), "application/json");
    }
    if (body.meta) {
      // day settings: a device that loaded older settings cannot roll back newer ones
      if (!m.metaAt || !body.metaAt || body.metaAt >= m.metaAt) { m.meta = body.meta; m.metaAt = stamp(m.metaAt ?? ""); }
    }
    m.savedAt = stamp(m.savedAt);
    await writeManifest(folder, m);
    return NextResponse.json({ ok: true, people: out, rejected, meta: m.meta, metaAt: m.metaAt, savedAt: m.savedAt });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "save failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const day = dayKey(req);
  if (!day) return NextResponse.json({ error: "date=DDMMYYYY required" }, { status: 400 });
  try {
    const office = officeOf(req);
    let blobs = await blobList(folderOf(req, day));
    if (office && req.nextUrl.searchParams.get("legacy") === "1") {
      // only on explicit request: the legacy (unsplit) copy may hold people from
      // several offices, so clearing one office's board must not take it along
      const legacy = await blobGetJson<OldIndex>(`${nsOf(req)}/${day}/index.json`);
      if (legacy && ((legacy.meta?.office as string | undefined) ?? "") === office) {
        const all = await blobList(`${nsOf(req)}/${day}/`);
        const officeDirs = new Set(all.map((b) => b.pathname.split("/")[2]).filter((x) => /^[A-Z][A-Z0-9_]+$/.test(x)));
        blobs = [...blobs, ...all.filter((b) => !officeDirs.has(b.pathname.split("/")[2]))];
      }
    }
    if (blobs.length) await blobDelete(blobs.map((b) => b.url));
    return NextResponse.json({ ok: true, deleted: blobs.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "delete failed" }, { status: 500 });
  }
}
