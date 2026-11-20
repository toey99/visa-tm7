// GET  /api/stats?from=YYYY-MM-DD&to=YYYY-MM-DD  → { pricing, days: DaySummary[], rows?: … }
// POST /api/stats { pricing }                      → saves pricing/config.json
// POST /api/stats { rebuild: "YYYY-MM-DD" }        → re-snapshots one day from the boards
// Signed-in users only (proxy).
import { NextRequest, NextResponse } from "next/server";
import { addDays, bkkToday, loadPricing, savePricing, snapshotDay, statsRange, summarize } from "@/lib/stats/daily";
import { withDefaults, type Pricing } from "@/lib/stats/pricing";
import { jobsInRange } from "@/lib/jobs/store";
import { extrasInRange } from "@/lib/extras/store";

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
    // long-stay visa jobs (Non-O, Non-B …) count on the day they were filed
    const jobs = (await jobsInRange(from, to).catch(() => [])).filter((j) => j.status !== "ยกเลิก");
    for (const j of jobs) {
      const d = days.find((x) => x.day === j.day);
      if (!d) continue;
      d.people += 1; d.jobs = (d.jobs ?? 0) + 1;
      d.sale += j.sale; d.cost += j.cost; d.profit = d.sale - d.cost;
      const a = j.agent || "ลูกค้าตรง";
      const ag = (d.byAgent[a] ??= { people: 0, sale: 0, cost: 0 });
      ag.people += 1; ag.sale += j.sale; ag.cost += j.cost;
    }
    // off-board work entered by hand on the dashboard (lump lines: people, sale, cost, counter money)
    const extras = await extrasInRange(from, to).catch(() => []);
    for (const x of extras) {
      const d = days.find((y) => y.day === x.day);
      if (!d) continue;
      d.people += x.people; d.arrived += x.people; d.extras = (d.extras ?? 0) + x.people;
      d.sale += x.sale; d.cost += x.cost; d.profit = d.sale - d.cost;
      if (x.how !== "none") d.collected += x.sale;
      const ag = (d.byAgent[x.agent || "ลูกค้าตรง"] ??= { people: 0, sale: 0, cost: 0 });
      ag.people += x.people; ag.sale += x.sale; ag.cost += x.cost;
    }
    return NextResponse.json({ pricing, days, extras, from, to }, { headers: { "Cache-Control": "no-store" } });
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
