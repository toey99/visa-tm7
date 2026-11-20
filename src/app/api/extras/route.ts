// GET  /api/extras?from=YYYY-MM-DD&to=YYYY-MM-DD → { extras }
// POST /api/extras { extra }                      → add one off-board line
// POST /api/extras { delete: { day, id } }        → remove it
// Signed-in users only (proxy).
import { NextRequest, NextResponse } from "next/server";
import { extrasInRange, removeExtra, saveExtra, type Extra } from "@/lib/extras/store";

export const runtime = "nodejs";
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; };
const s = (v: unknown, max = 200) => String(v ?? "").slice(0, max);
const isDay = (d: unknown): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d);
const today = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const to = isDay(q.get("to")) ? (q.get("to") as string) : today();
    const from = isDay(q.get("from")) ? (q.get("from") as string) : to;
    return NextResponse.json({ extras: await extrasInRange(from, to) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "extras failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { extra?: Partial<Extra>; delete?: { day: string; id: string } };
    if (body.delete) {
      if (!isDay(body.delete.day)) return NextResponse.json({ error: "วันที่ไม่ถูกต้อง" }, { status: 400 });
      await removeExtra(body.delete.day.slice(0, 7), s(body.delete.id));
      return NextResponse.json({ ok: true });
    }
    const x = body.extra;
    if (!x || !isDay(x.day) || x.day > today() || !s(x.label).trim()) return NextResponse.json({ error: "ต้องมีวันที่ (ไม่เกินวันนี้) และชื่อรายการ" }, { status: 400 });
    const sale = Math.max(0, num(x.sale)), cost = Math.max(0, num(x.cost));
    if (!sale && !cost) return NextResponse.json({ error: "ต้องใส่ยอดขายหรือต้นทุน" }, { status: 400 });
    const extra: Extra = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      day: x.day, label: s(x.label).trim(), people: Math.max(0, Math.floor(num(x.people))), sale, cost,
      how: x.how === "transfer" || x.how === "none" ? x.how : "cash",
      agent: s(x.agent, 60).trim() || "ลูกค้าตรง", createdAt: "", updatedAt: "",
    };
    return NextResponse.json({ extra: await saveExtra(extra) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "extras failed" }, { status: 500 });
  }
}
