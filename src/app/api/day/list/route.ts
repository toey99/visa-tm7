// GET /api/day/list → { days: [{ date: "DDMMYYYY", people: n, office }] } newest first
import { NextResponse } from "next/server";
import { blobList } from "@/lib/blob";

export const runtime = "nodejs";

export async function GET() {
  try {
    const blobs = await blobList("days/");
    const days = new Map<string, { date: string; files: number; updated: string }>();
    for (const b of blobs) {
      const m = b.pathname.match(/^days\/(\d{8})\//);
      if (!m) continue;
      const cur = days.get(m[1]) ?? { date: m[1], files: 0, updated: b.uploadedAt };
      cur.files++;
      if (b.uploadedAt > cur.updated) cur.updated = b.uploadedAt;
      days.set(m[1], cur);
    }
    const sortKey = (d: string) => d.slice(4) + d.slice(2, 4) + d.slice(0, 2); // DDMMYYYY → YYYYMMDD
    const list = [...days.values()].sort((a, b) => sortKey(b.date).localeCompare(sortKey(a.date)));
    return NextResponse.json({ days: list }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "list failed" }, { status: 500 });
  }
}
