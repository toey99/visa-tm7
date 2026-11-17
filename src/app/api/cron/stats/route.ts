// GET /api/cron/stats — nightly (23:30 Bangkok): snapshot yesterday + today and
// backfill any of the last 7 days still missing, before the weekly purge.
// Vercel cron sends "Authorization: Bearer <CRON_SECRET>".
import { NextRequest, NextResponse } from "next/server";
import { addDays, bkkToday, loadDayStats, snapshotDay } from "@/lib/stats/daily";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const today = bkkToday();
  const done: string[] = [];
  for (let i = 7; i >= 0; i--) {
    const d = addDays(today, -i);
    const have = await loadDayStats(d);
    if (have?.final && i > 1) continue;              // old and already frozen
    await snapshotDay(d, i <= 1);                    // today + yesterday always rebuilt (edits land late)
    done.push(d);
  }
  return NextResponse.json({ ok: true, snapshotted: done });
}
