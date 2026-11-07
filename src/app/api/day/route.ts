// GET  /api/day?date=DDMMYYYY  → the day's index (people + meta, no binaries) or {} if none
// PUT  /api/day?date=DDMMYYYY  → save the day's index (body = JSON)
// DELETE /api/day?date=DDMMYYYY → delete the whole day (index + files)
import { NextRequest, NextResponse } from "next/server";
import { blobDelete, blobGetJson, blobList, blobPut } from "@/lib/blob";

export const runtime = "nodejs";

function dayKey(req: NextRequest): string | null {
  const d = req.nextUrl.searchParams.get("date") ?? "";
  return /^\d{8}$/.test(d) ? d : null;
}

export async function GET(req: NextRequest) {
  const day = dayKey(req);
  if (!day) return NextResponse.json({ error: "date=DDMMYYYY required" }, { status: 400 });
  try {
    const idx = await blobGetJson<unknown>(`days/${day}/index.json`);
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
    await blobPut(`days/${day}/index.json`, body, "application/json");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "save failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const day = dayKey(req);
  if (!day) return NextResponse.json({ error: "date=DDMMYYYY required" }, { status: 400 });
  try {
    const blobs = await blobList(`days/${day}/`);
    if (blobs.length) await blobDelete(blobs.map((b) => b.url));
    return NextResponse.json({ ok: true, deleted: blobs.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "delete failed" }, { status: 500 });
  }
}
