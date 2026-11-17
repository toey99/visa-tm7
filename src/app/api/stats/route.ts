// GET  /api/stats?from=YYYY-MM-DD&to=YYYY-MM-DD  → { pricing, days: DaySummary[], rows?: … }
// POST /api/stats { pricing }                      → saves pricing/config.json
// POST /api/stats { rebuild: "YYYY-MM-DD" }        → re-snapshots one day from the boards
// Signed-in users only (proxy).
import { NextRequest, NextResponse } from "next/server";
import { addDays, bkkToday, loadPricing, savePricing, snapshotDay, statsRange, summarize } from "@/lib/stats/daily";
import { withDefaults, type Pricing } from "@/lib/stats/pricing";

export const runtime = "nodejs";
export const maxDuration = 60;
const safeDay = (d: unknown) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const to = safeDay(q.get("to")) ?? bkkToday();
    const from = safeDay(q.get("from")) ?? addDays(to, -29);
    const pricing = await loadPricing();
    const days = (await statsRange(from, to)).map((s) => summarize(s, pricing));
    return NextResponse.json({ pricing, days, from, to }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "stats failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { pricing?: Partial<Pricing>; rebuild?: string };
    if (body.pricing) { await savePricing(withDefaults(body.pricing)); }
    const day = safeDay(body.rebuild);
    if (day) await snapshotDay(day, true);
    return NextResponse.json({ ok: true, pricing: await loadPricing() }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "stats failed" }, { status: 500 });
  }
}
