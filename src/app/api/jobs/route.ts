// GET  /api/jobs?month=YYYY-MM            → { jobs }
// POST /api/jobs { job, prevMonth? }       → upsert (prevMonth when the day moved to another month)
// POST /api/jobs { delete: { month, id } } → remove
import { NextRequest, NextResponse } from "next/server";
import { JOB_STATUS, listJobs, removeJob, saveJob, type Job } from "@/lib/jobs/store";

export const runtime = "nodejs";
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; };
const s = (v: unknown, max = 200) => String(v ?? "").slice(0, max);

export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get("month") ?? new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);
  return NextResponse.json({ jobs: await listJobs(month) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { job?: Partial<Job>; prevMonth?: string; delete?: { month: string; id: string } };
    if (body.delete) { await removeJob(body.delete.month, body.delete.id); return NextResponse.json({ ok: true }); }
    const j = body.job;
    if (!j || !/^\d{4}-\d{2}-\d{2}$/.test(String(j.day)) || !s(j.customer).trim()) return NextResponse.json({ error: "ต้องมีวันที่และชื่อลูกค้า" }, { status: 400 });
    const job: Job = {
      id: s(j.id) || Date.now().toString(36), day: String(j.day), type: s(j.type) || "อื่น ๆ",
      customer: s(j.customer).trim().toUpperCase(), cn: s(j.cn), passportNo: s(j.passportNo).toUpperCase(), nationality: s(j.nationality).toUpperCase(),
      agent: s(j.agent).trim() || "ลูกค้าตรง", office: s(j.office), sale: num(j.sale), cost: num(j.cost), costNote: s(j.costNote, 400),
      status: (JOB_STATUS as readonly string[]).includes(String(j.status)) ? (j.status as Job["status"]) : "ยื่นแล้ว",
      dueDay: /^\d{4}-\d{2}-\d{2}$/.test(String(j.dueDay)) ? String(j.dueDay) : "", note: s(j.note, 1000),
      paid: j.paid === "paid" || j.paid === "agent" ? j.paid : "pending",
      createdAt: s(j.createdAt), updatedAt: "",
    };
    if (body.prevMonth && body.prevMonth !== job.day.slice(0, 7)) await removeJob(body.prevMonth, job.id);
    return NextResponse.json({ job: await saveJob(job) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "jobs failed" }, { status: 500 });
  }
}
