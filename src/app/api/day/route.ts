// GET  /api/day?date=DDMMYYYY[&ns=run][&office=BANGKOK]  → the day's index (people + meta, no binaries) or {} if none
// PUT  /api/day?date=DDMMYYYY  → save the day's index (body = JSON)
// DELETE /api/day?date=DDMMYYYY → delete the whole day (index + files)
import { NextRequest, NextResponse } from "next/server";
import { blobDelete, blobGetJson, blobList, blobPut } from "@/lib/blob";

export const runtime = "nodejs";

// ns = "days" (extension board, default) | "run" (visa-run board)
function nsOf(req: NextRequest): string {
  return req.nextUrl.searchParams.get("ns") === "run" ? "run" : "days";
}
function dayKey(req: NextRequest): string | null {
  const d = req.nextUrl.searchParams.get("date") ?? "";
  return /^\d{8}$/.test(d) ? d : null;
}
// office = OfficeId (BANGKOK, NONTHABURI, …). Each office has its own folder
// inside the day, so the same date at two offices never shares customers.
// Days saved before this split live directly under <ns>/<day>/ (legacy).
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
  try {
    let idx = await blobGetJson<{ meta?: { office?: string } }>(`${folderOf(req, day)}index.json`);
    const office = officeOf(req);
    if (!idx && office) {
      // legacy day (pre office-split): hand it to the office it was saved under
      const legacy = await blobGetJson<{ meta?: { office?: string } }>(`${nsOf(req)}/${day}/index.json`);
      if (legacy && (legacy.meta?.office ?? "") === office) idx = legacy;
    }
    return NextResponse.json(idx ?? {}, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "read failed" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const day = dayKey(req);
  if (!day) return NextResponse.json({ error: "date=DDMMYYYY required" }, { status: 400 });
  try {
    const body = await req.text();
    if (body.length > 2_000_000) return NextResponse.json({ error: "index too large" }, { status: 413 });
    JSON.parse(body); // validate
    await blobPut(`${folderOf(req, day)}index.json`, body, "application/json");
    return NextResponse.json({ ok: true });
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
      const legacy = await blobGetJson<{ meta?: { office?: string } }>(`${nsOf(req)}/${day}/index.json`);
      if (legacy && (legacy.meta?.office ?? "") === office) {
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
