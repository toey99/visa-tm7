// =============================================================
// Day boards — server-side storage (shared by /api/day and the LINE inbox bot)
// =============================================================
// Layout per board = <ns>/<day>/<office>/ :
//   manifest.json            { meta, metaAt, savedAt, entries: { [personId]: { updatedAt, order } } }
//   people/<personId>.json   one record per person (a deleted person leaves a tombstone)
//   <personId>/<file>        uploaded documents and generated outputs
//   index.json               older boards only (marked migrated:true once read)
//
// See src/app/api/day/route.ts for the why; this file holds the mechanics so
// the LINE bot can file people onto a board through exactly the same merge.
import { blobGetJson, blobList, blobPut } from "@/lib/blob";

export type PersonRec = { id: string; order: number; updatedAt?: string; fields?: Record<string, unknown>; tombstone?: boolean; deletedAt?: string; [k: string]: unknown };
export type Manifest = { meta?: Record<string, unknown>; metaAt?: string; savedAt: string; entries: Record<string, { updatedAt: string; order: number }> };
export type SaveBody = { v?: number; meta?: Record<string, unknown>; metaAt?: string; people?: PersonRec[]; bases?: Record<string, PersonRec>; deleted?: string[]; known?: string[]; revive?: boolean };
export type SaveResult = { ok: true; people: PersonRec[]; rejected: string[]; meta?: Record<string, unknown>; metaAt?: string; savedAt: string };
type OldIndex = { meta?: Record<string, unknown>; people?: PersonRec[]; savedAt?: string; migrated?: boolean };

export const safeId = (id: unknown) => typeof id === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(id) && id !== "people" ? id : null;
export const recPath = (folder: string, id: string) => `${folder}people/${id}.json`;
export const boardFolder = (ns: "days" | "run", day: string, office: string) => `${ns}/${day}/${office}/`;

// Server-side version stamp: ISO time, strictly greater than anything this
// instance handed out before and than `notBefore` (the board's previous
// version), so ordering never depends on a phone's clock.
let lastStamp = "";
export function stamp(notBefore = ""): string {
  const floor = lastStamp > notBefore ? lastStamp : notBefore;
  let t = Date.now();
  const floorT = floor ? new Date(floor).getTime() : 0;
  if (Number.isFinite(floorT) && t <= floorT) t = floorT + 1;
  const s = new Date(t).toISOString();
  lastStamp = s;
  return s;
}

export async function readManifest(folder: string): Promise<Manifest | null> {
  return blobGetJson<Manifest>(`${folder}manifest.json`);
}
export async function writeManifest(folder: string, m: Manifest): Promise<void> {
  await blobPut(`${folder}manifest.json`, JSON.stringify(m), "application/json");
}
export async function readRecords(folder: string, ids: string[]): Promise<PersonRec[]> {
  const recs = await Promise.all(ids.map((id) => blobGetJson<PersonRec>(recPath(folder, id))));
  return recs.filter((p): p is PersonRec => !!p && !!safeId(p.id) && !p.tombstone);
}

// Three-way merge of one person: start from the server copy, apply only the
// changes this device made relative to the record it loaded (`base`).
export function merge(cur: PersonRec, incoming: PersonRec, base: PersonRec | undefined): PersonRec {
  if (!base) return { ...incoming, order: cur.order ?? incoming.order };  // no base: this device's copy wins whole
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const out: PersonRec = { ...cur };
  for (const k of new Set([...Object.keys(incoming), ...Object.keys(base)])) {
    if (k === "fields" || k === "files" || k === "updatedAt" || k === "id") continue;
    if (!same(incoming[k], base[k])) out[k] = incoming[k];
  }
  if (incoming.fields) {
    const f: Record<string, unknown> = { ...(cur.fields ?? {}) };
    const inF = incoming.fields, baseF = base.fields ?? {};
    for (const k of new Set([...Object.keys(inF), ...Object.keys(baseF)])) {
      if (!same(inF[k], baseF[k])) f[k] = inF[k];
    }
    out.fields = f;
  }
  type F = { id: string; [k: string]: unknown };
  const curF = (cur.files as F[] | undefined) ?? [], inFiles = (incoming.files as F[] | undefined) ?? [], baseFiles = (base.files as F[] | undefined) ?? [];
  const removedHere = new Set(baseFiles.filter((b) => !inFiles.some((x) => x.id === b.id)).map((b) => b.id));
  const merged: F[] = curF.filter((c) => !removedHere.has(c.id)).map((c) => inFiles.find((x) => x.id === c.id) ?? c);
  for (const x of inFiles) if (!merged.some((c) => c.id === x.id)) merged.push(x);
  out.files = merged;
  return out;
}

// One-time migrations, each only on a board that has no manifest yet.
export async function migrate(ns: string, day: string, office: string | null, folder: string): Promise<Manifest | null> {
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
  if ((!idx || idx.migrated) && office) {
    const legacyPath = `${ns}/${day}/index.json`;
    const legacy = await blobGetJson<OldIndex>(legacyPath);
    if (legacy && !legacy.migrated && ((legacy.meta?.office as string | undefined) ?? "") === office) { idx = legacy; srcPath = legacyPath; }
  }
  if (!idx || idx.migrated || (!idx.people?.length && !idx.meta)) {
    const empty: Manifest = { savedAt: stamp(), entries: {} };
    await writeManifest(folder, empty);
    return empty;
  }
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

/** The board's manifest, migrating older layouts on first read; null when the board has nothing at all. */
export async function loadManifest(ns: string, day: string, office: string | null, folder: string): Promise<Manifest | null> {
  return (await readManifest(folder)) ?? (await migrate(ns, day, office, folder));
}

/** Merge a save into a board — the single write path for the app and the LINE bot. */
export async function saveToBoard(ns: string, day: string, office: string | null, folder: string, body: SaveBody): Promise<SaveResult> {
  const m: Manifest = (await loadManifest(ns, day, office, folder)) ?? { savedAt: stamp(), entries: {} };
  const deleted = new Set((body.deleted ?? []).map(safeId).filter((x): x is string => !!x));
  const out: PersonRec[] = [];
  const rejected: string[] = [];

  for (const id of deleted) {
    delete m.entries[id];
    await blobPut(recPath(folder, id), JSON.stringify({ id, tombstone: true, deletedAt: stamp(m.entries[id]?.updatedAt ?? m.savedAt) }), "application/json");
  }
  for (const p of body.people ?? []) {
    const id = safeId(p.id);
    if (!id || deleted.has(id)) continue;
    const entry = m.entries[id];
    const base = body.bases?.[id];
    const cur = await blobGetJson<PersonRec>(recPath(folder, id));
    if (cur?.tombstone) {
      const editedAfterDelete = !!base && (base.updatedAt ?? "") > (cur.deletedAt ?? "");
      if (!(body.revive && !base) && !editedAfterDelete) { rejected.push(id); continue; }
    }
    const untouched = !cur || !!cur.tombstone || (!!base?.updatedAt && base.updatedAt === cur.updatedAt);
    let next: PersonRec = untouched || !cur ? { ...p, id } : merge(cur, { ...p, id }, base);
    const s = stamp(cur?.updatedAt ?? entry?.updatedAt ?? "");
    next = { ...next, updatedAt: s };
    delete next.tombstone; delete next.deletedAt;
    await blobPut(recPath(folder, id), JSON.stringify(next), "application/json");
    m.entries[id] = { updatedAt: s, order: next.order ?? cur?.order ?? 0 };
    out.push(next);
  }
  for (const k of body.known ?? []) {
    const id = safeId(k);
    if (id && !m.entries[id] && !deleted.has(id)) {
      const rec = await blobGetJson<PersonRec>(recPath(folder, id));
      if (rec && !rec.tombstone) m.entries[id] = { updatedAt: rec.updatedAt ?? m.savedAt, order: rec.order ?? 0 };
    }
  }
  if (body.meta) {
    if (!m.metaAt || !body.metaAt || body.metaAt >= m.metaAt) { m.meta = body.meta; m.metaAt = stamp(m.metaAt ?? ""); }
  }
  const latest = await readManifest(folder);
  if (latest) {
    for (const [id, e] of Object.entries(latest.entries)) {
      if (deleted.has(id)) continue;
      if (!m.entries[id] || e.updatedAt > m.entries[id].updatedAt) m.entries[id] = e;
    }
    if (latest.metaAt && (!m.metaAt || latest.metaAt > m.metaAt)) { m.meta = latest.meta; m.metaAt = latest.metaAt; }
  }
  m.savedAt = stamp(m.savedAt);
  await writeManifest(folder, m);
  return { ok: true, people: out, rejected, meta: m.meta, metaAt: m.metaAt, savedAt: m.savedAt };
}
