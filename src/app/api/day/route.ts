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
import { blobDelete, blobGetJson, blobList } from "@/lib/blob";
import { loadManifest, readRecords, recPath, safeId, saveToBoard, type PersonRec } from "@/lib/day-server";

export const runtime = "nodejs";

type OldIndex = { meta?: Record<string, unknown>; people?: PersonRec[]; savedAt?: string; migrated?: boolean };

function nsOf(req: NextRequest): "days" | "run" {
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
    const m = await loadManifest(nsOf(req), day, officeOf(req), folder);
    if (!m) return NextResponse.json({}, noStore);
    if (req.nextUrl.searchParams.get("manifest") === "1") return NextResponse.json(m, noStore);
    if (!Object.keys(m.entries).length && !m.meta) return NextResponse.json({}, noStore);
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
    const body = JSON.parse(text) as { v?: number } & Parameters<typeof saveToBoard>[4];
    // a tab still running the old full-list client must not write: reload it
    if (body.v !== 2) return NextResponse.json({ error: "หน้าเว็บเป็นเวอร์ชันเก่า — รีเฟรชหน้า 1 ครั้งแล้วลองใหม่" }, { status: 409 });
    const res = await saveToBoard(nsOf(req), day, officeOf(req), folderOf(req, day), body);
    return NextResponse.json(res);
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
