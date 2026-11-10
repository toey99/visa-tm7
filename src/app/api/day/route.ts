// GET    /api/day?date=DDMMYYYY[&ns=run][&office=BANGKOK]  → the day's index (people + meta, no binaries) or {} if none
// PUT    /api/day?date=DDMMYYYY&office=…  body = { meta, people, deleted? }  → MERGE into the board
// DELETE /api/day?date=DDMMYYYY&office=…  → delete the whole board (records + files)
//
// Storage (per board = <ns>/<day>/<office>/):
//   people/<personId>.json   one record per person — fields, flags, file refs, updatedAt
//   meta.json                the day's settings (office, extension days, flight …)
//   <personId>/<file>        uploaded documents and generated outputs
//
// Why per-person records: the board used to be one index.json with the whole
// list, saved from the client after every change. Two devices on the same board
// (or a stale tab) each wrote the list they had, and the last writer silently
// dropped everyone the other device had added — that is what lost a morning's
// customers on 10/11/2026. Now a save only touches the people it carries and
// never removes anyone; removal is explicit (`deleted: [ids]`), and a record is
// only overwritten by a newer one (updatedAt), so a stale tab cannot roll back
// a fresh edit either.
//
// Older boards (index.json with the full list, or the pre-office-split
// <ns>/<day>/index.json) are migrated to people/*.json the first time they are
// read; the old index is left in place as a frozen backup.
import { NextRequest, NextResponse } from "next/server";
import { blobDelete, blobGetJson, blobList, blobPut } from "@/lib/blob";

export const runtime = "nodejs";

type PersonRec = { id: string; order: number; updatedAt?: string; [k: string]: unknown };
type Index = { meta?: Record<string, unknown>; people?: PersonRec[]; savedAt?: string; deleted?: string[]; migrated?: boolean };

// ns = "days" (extension board, default) | "run" (visa-run board)
function nsOf(req: NextRequest): string {
  return req.nextUrl.searchParams.get("ns") === "run" ? "run" : "days";
}
function dayKey(req: NextRequest): string | null {
  const d = req.nextUrl.searchParams.get("date") ?? "";
  return /^\d{8}$/.test(d) ? d : null;
}
// office = OfficeId (BANGKOK, NONTHABURI, …). Each office has its own folder inside the day.
function officeOf(req: NextRequest): string | null {
  const o = req.nextUrl.searchParams.get("office") ?? "";
  return /^[A-Z][A-Z0-9_]{1,30}$/.test(o) ? o : null;
}
function folderOf(req: NextRequest, day: string): string {
  const o = officeOf(req);
  return o ? `${nsOf(req)}/${day}/${o}/` : `${nsOf(req)}/${day}/`;
}
const safeId = (id: unknown) => typeof id === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(id) ? id : null;

async function readBoard(folder: string): Promise<{ meta?: Record<string, unknown>; people: PersonRec[]; hasRecords: boolean }> {
  const blobs = await blobList(`${folder}people/`);
  const recs = blobs.filter((b) => /\/people\/[A-Za-z0-9_.-]+\.json$/.test(b.pathname));
  const people = (await Promise.all(recs.map((b) => blobGetJson<PersonRec>(b.pathname)))).filter((p): p is PersonRec => !!p && !!safeId(p.id));
  const meta = (await blobGetJson<Record<string, unknown>>(`${folder}meta.json`)) ?? undefined;
  return { meta, people, hasRecords: recs.length > 0 || !!meta };
}

async function writePeople(folder: string, people: PersonRec[], stamp: string): Promise<number> {
  // newest wins per person: never let a stale tab overwrite a fresher record
  let written = 0;
  await Promise.all(people.map(async (p) => {
    const id = safeId(p.id);
    if (!id) return;
    const cur = await blobGetJson<PersonRec>(`${folder}people/${id}.json`);
    const incoming = { ...p, updatedAt: p.updatedAt || stamp };
    if (cur?.updatedAt && incoming.updatedAt && cur.updatedAt > incoming.updatedAt) return;
    await blobPut(`${folder}people/${id}.json`, JSON.stringify(incoming), "application/json");
    written++;
  }));
  return written;
}

export async function GET(req: NextRequest) {
  const day = dayKey(req);
  if (!day) return NextResponse.json({ error: "date=DDMMYYYY required" }, { status: 400 });
  try {
    const folder = folderOf(req, day);
    const board = await readBoard(folder);
    if (!board.hasRecords) {
      // first read of an older board: migrate index.json (this folder, else the
      // pre-split legacy index if it was saved under this office) into records
      let idx = await blobGetJson<Index>(`${folder}index.json`);
      const office = officeOf(req);
      if ((!idx || idx.migrated) && office) {
        const legacy = await blobGetJson<Index>(`${nsOf(req)}/${day}/index.json`);
        if (legacy && !legacy.migrated && ((legacy.meta?.office as string | undefined) ?? "") === office) idx = legacy;
      }
      if (idx && !idx.migrated && (idx.people?.length || idx.meta)) {
        const stamp = idx.savedAt ?? new Date().toISOString();
        await writePeople(folder, idx.people ?? [], stamp);
        if (idx.meta) await blobPut(`${folder}meta.json`, JSON.stringify(idx.meta), "application/json");
        return NextResponse.json({ meta: idx.meta, people: idx.people ?? [], savedAt: stamp, migratedFrom: "index" }, { headers: { "Cache-Control": "no-store" } });
      }
      return NextResponse.json({}, { headers: { "Cache-Control": "no-store" } });
    }
    board.people.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return NextResponse.json({ meta: board.meta, people: board.people }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "read failed" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const day = dayKey(req);
  if (!day) return NextResponse.json({ error: "date=DDMMYYYY required" }, { status: 400 });
  try {
    const text = await req.text();
    if (text.length > 4_000_000) return NextResponse.json({ error: "index too large" }, { status: 413 });
    const body = JSON.parse(text) as Index;
    const folder = folderOf(req, day);
    const stamp = new Date().toISOString();
    const written = await writePeople(folder, body.people ?? [], stamp);
    if (body.meta) await blobPut(`${folder}meta.json`, JSON.stringify(body.meta), "application/json");
    const deleted = (body.deleted ?? []).map(safeId).filter((x): x is string => !!x);
    if (deleted.length) {
      const recs = await blobList(`${folder}people/`);
      const victims = recs.filter((b) => deleted.some((id) => b.pathname === `${folder}people/${id}.json`));
      if (victims.length) await blobDelete(victims.map((b) => b.url));
    }
    return NextResponse.json({ ok: true, written, deleted: deleted.length });
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
      const legacy = await blobGetJson<Index>(`${nsOf(req)}/${day}/index.json`);
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
