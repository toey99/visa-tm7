// GET /api/summary/png?ns=days|run&day=DDMMYYYY&office=BANGKOK[&agent=อาเต่า]
// → the board's summary sheet as a PNG, drawn on the server (same picture the
//   LINE bot sends). Signed-in users only (proxy).
import { NextRequest, NextResponse } from "next/server";
import { OFFICES, type OfficeId } from "@/lib/offices";
import { renderSummaryPng } from "@/lib/summary/render";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const ns = q.get("ns") === "run" ? "run" : "days";
  const day = q.get("day") ?? "";
  const office = q.get("office") ?? "";
  if (!/^\d{8}$/.test(day) || !(office in OFFICES)) return NextResponse.json({ error: "day (DDMMYYYY) and office required" }, { status: 400 });
  try {
    const r = await renderSummaryPng({ ns, office: office as OfficeId }, day, q.get("agent") ?? "");
    return new NextResponse(r.png, { headers: { "Content-Type": "image/png", "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "render failed", where: e instanceof Error ? (e.stack ?? "").split("\n").slice(1, 7).map((l) => l.trim()) : [] }, { status: 500 });
  }
}
