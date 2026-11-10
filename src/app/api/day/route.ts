// GET    /api/day?date=DDMMYYYY[&ns=run][&office=BANGKOK]            → { meta, people:[records] }  (or {} if none)
// GET    /api/day?…&manifest=1                                          → { meta, savedAt, entries:{id:{updatedAt,order}} } — cheap change check
// GET    /api/day?…&person=<id>                                         → one person record
// PUT    /api/day?date=…&office=…  body = { meta?, people?, deleted?, known? } → MERGE into the board
// DELETE /api/day?date=…&office=…                                       → delete the whole board (records + files)
//
// Storage (per board = <ns>/<day>/<office>/):
//   manifest.json            { meta, savedAt, entries: { [personId]: { updatedAt, order } } }
//   people/<personId>.json   one record per person — fields, flags, file refs, updatedAt
//   <personId>/<file>        uploaded documents and generated outputs
//   index.json               older boards only (frozen after migration)
//
// Why this shape. The board used to be one index.json holding the whole list,
// saved from the client after every change: two devices on the same board each
// wrote the list they had and the last writer silently dropped everyone the
// other had added (that lost a morning's customers on 10/11/2026). Now:
//   • each person is their own blob, so two devices adding people never collide;
//   • a save only carries the people that changed here, and a record is only
//     replaced by a newer one (updatedAt), so a stale tab cannot roll back a
//     fresh edit;
//   • nobody is removed unless the save says so (`deleted`);
//   • the manifest is just a directory (ids + updatedAt) so a board can be
//     opened and re-synced WITHOUT list(): on the Hobby plan list() and put()
//     share a 2,000/month budget, so the hot path must not list. If two saves
//     race on the manifest the loser's id can be missing for a moment — the
//     client sends every id it knows (`known`) with each save, so the next
//     save from either device repairs it; the record itself was never at risk.
import { NextRequest, NextResponse } from "next/server";
import { blobDelete, blobDeleteByPath, blobGetJson, blobList, blobPut } from "@/lib/blob";

export const runtime = "nodejs";

type PersonRec = { id: string; order: number; updatedAt?: string; [k: string]: unknown };
type Manifest = { meta?: Record<string, unknown>; savedAt: string; entries: Record<string, { updatedAt: string; order: number }> };
type SaveBody = { meta?: Record<string, unknown>; people?: PersonRec[]; deleted?: string[]; known?: string[] };
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
const now = () => new Date().toISOString();
const recPath = (folder: string, id: string) => `${folder}people/${id}.json`;

async function readManifest(folder: string): Promise<Manifest | null> {
  return blobGetJson<Manifest>(`${folder}manifest.json`);
}
async function writeManifest(folder: string, m: Manifest): Promise<void> {
  await blobPut(`${folder}manifest.json`, JSON.stringify(m), "application/json");
}
async function readRecords(folder: string, ids: string[]): Promise<PersonRec[]> {
  const recs = await Promise.all(ids.map((id) => blobGetJson<PersonRec>(recPath(folder, id))));
  return recs.filter((p): p is PersonRec => !!p && !!safeId(p.id));
}

// One-time migrations, each costing a few operations and only on a board that has no manifest yet:
//  a) records already exist under people/ (yesterday's interim layout) → list once, build the manifest
//  b) index.json with the full list (older layout) → write records + manifest
//  c) pre-office-split <ns>/<day>/index.json saved under this office → same as (b)
async function migrate(req: NextRequest, folder: string, day: string): Promise<Manifest | null> {
  const recBlobs = await blobList(`${folder}people/`);
  const recs = recBlobs.filter((b) => /\/people\/[A-Za-z0-9_.-]+\.json$/.test(b.pathname));
  if (recs.length) {
    const people = (await Promise.all(recs.map((b) => blobGetJson<PersonRec>(b.pathname)))).filter((p): p is PersonRec => !!p && !!safeId(p.id));
    const meta = (await blobGetJson<Record<string, unknown>>(`${folder}meta.json`)) ?? undefined;
    const m: Manifest = { meta, savedAt: now(), entries: {} };
    for (const p of people) m.entries[p.id] = { updatedAt: p.updatedAt ?? m.savedAt, order: p.order ?? 0 };
    await writeManifest(folder, m);
    return m;
  }
  let idx = await blobGetJson<OldIndex>(`${folder}index.json`);
  const office = officeOf(req);
  if ((!idx || idx.migrated) && office) {
    const legacy = await blobGetJson<OldIndex>(`${nsOf(req)}/${day}/index.json`);
    if (legacy && !legacy.migrated && ((legacy.meta?.office as string | undefined) ?? "") === office) idx = legacy;
  }
  if (!idx || idx.migrated || (!idx.people?.length && !idx.meta)) return null;
  const stamp = idx.savedAt ?? now();
  const m: Manifest = { meta: idx.meta, savedAt: stamp, entries: {} };
  await Promise.all((idx.people ?? []).map(async (p) => {
    const id = safeId(p.id);
    if (!id) return;
    const rec = { ...p, updatedAt: p.updatedAt || stamp };
    await blobPut(recPath(folder, id), JSON.stringify(rec), "application/json");
    m.entries[id] = { updatedAt: rec.updatedAt, order: p.order ?? 0 };
  }));
  await writeManifest(folder, m);
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
      return rec ? NextResponse.json(rec, noStore) : NextResponse.json({ error: "not found" }, { status: 404, ...noStore });
    }
    let m = await readManifest(folder);
    if (!m) m = await migrate(req, folder, day);
    if (!m) return NextResponse.json({}, noStore);
    if (req.nextUrl.searchParams.get("manifest") === "1") return NextResponse.json(m, noStore);
    const people = await readRecords(folder, Object.keys(m.entries));
    people.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return NextResponse.json({ meta: m.meta, people, savedAt: m.savedAt }, noStore);
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
    const folder = folderOf(req, day);
    const stamp = now();
    const m: Manifest = (await readManifest(folder)) ?? (await migrate(req, folder, day)) ?? { savedAt: stamp, entries: {} };
    const deleted = new Set((body.deleted ?? []).map(safeId).filter((x): x is string => !!x));

    // people: newest wins per record; a stale tab never rolls back a fresher edit
    let written = 0;
    for (const p of body.people ?? []) {
      const id = safeId(p.id);
      if (!id || deleted.has(id)) continue;
      const incoming = { ...p, id, updatedAt: p.updatedAt || stamp };
      const cur = m.entries[id];
      if (cur && cur.updatedAt > incoming.updatedAt) continue;
      await blobPut(recPath(folder, id), JSON.stringify(incoming), "application/json");
      m.entries[id] = { updatedAt: incoming.updatedAt, order: p.order ?? cur?.order ?? 0 };
      written++;
    }
    // ids this client knows about: repairs a manifest entry lost to a racing save
    for (const k of body.known ?? []) {
      const id = safeId(k);
      if (id && !m.entries[id] && !deleted.has(id)) {
        const rec = await blobGetJson<PersonRec>(recPath(folder, id));
        if (rec) m.entries[id] = { updatedAt: rec.updatedAt ?? stamp, order: rec.order ?? 0 };
      }
    }
    for (const id of deleted) delete m.entries[id];
    if (body.meta) m.meta = body.meta;
    m.savedAt = stamp;
    await writeManifest(folder, m);
    if (deleted.size) {
      // del() is free; the record goes, the person's files stay until the board is cleared
      await blobDeleteByPath([...deleted].map((id) => recPath(folder, id)));
    }
    return NextResponse.json({ ok: true, written, deleted: deleted.size, savedAt: stamp });
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
