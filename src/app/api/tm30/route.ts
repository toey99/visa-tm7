// TM.30 bot queue (see src/lib/tm30-jobs.ts). Signed-in users only — the proxy gates this route.
// GET   /api/tm30[?bot=1]                 → { jobs, botSeenAt }  (bot=1: the extension's poll, doubles as its heartbeat)
// POST  /api/tm30   multipart: meta (JSON { ns, day, office, label, people:[{id,passportNo,name}] }), file (the Excel) → { job }
// PATCH /api/tm30   JSON { id, who:"board"|"bot", status?, message?, preview? } → { job }  (409 when the move is not allowed)
import { NextRequest, NextResponse } from "next/server";
import { botSeen, canSet, cleanPassport, createJob, readQueue, updateJob, type Tm30Job, type Tm30JobPerson, type Tm30JobStatus } from "@/lib/tm30-jobs";
import { safeId } from "@/lib/day-server";

export const runtime = "nodejs";
const noStore = { headers: { "Cache-Control": "no-store" } };
const MAX_XLS = 2 * 1024 * 1024;

export async function GET(req: NextRequest) {
  try {
    const q = await readQueue();
    if (req.nextUrl.searchParams.get("bot") === "1") await botSeen(q).catch(() => undefined);
    return NextResponse.json({ jobs: q.jobs, botSeenAt: q.botSeenAt ?? null }, noStore);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "read failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData();
    const file = fd.get("file");
    const meta = JSON.parse(String(fd.get("meta") ?? "{}")) as Partial<Tm30Job>;
    if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "file required" }, { status: 400 });
    if (file.size > MAX_XLS) return NextResponse.json({ error: "file too large" }, { status: 413 });
    const ns = meta.ns === "run" ? "run" : meta.ns === "d90" ? "d90" : "days";
    const day = String(meta.day ?? "");
    const office = String(meta.office ?? "");
    if (!/^\d{8}$/.test(day) || !/^[A-Z][A-Z0-9_]{1,30}$/.test(office)) return NextResponse.json({ error: "day and office required" }, { status: 400 });
    const people: Tm30JobPerson[] = (Array.isArray(meta.people) ? meta.people : [])
      .map((p) => ({ id: safeId(p?.id) ?? "", passportNo: cleanPassport(p?.passportNo), name: String(p?.name ?? "").slice(0, 80) }))
      .filter((p) => p.id && p.passportNo);
    if (!people.length || people.length > 100) return NextResponse.json({ error: "1–100 people with passport numbers required" }, { status: 400 });
    const job = await createJob({ ns, day, office, label: String(meta.label ?? "").slice(0, 80), people }, await file.arrayBuffer());
    return NextResponse.json({ job }, noStore);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "create failed" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string; who?: string; status?: Tm30JobStatus; message?: string; preview?: unknown[] };
    const who = body.who === "bot" ? "bot" : "board";
    let refused = false;
    const job = await updateJob(String(body.id ?? ""), (j) => {
      if (body.status && body.status !== j.status) {
        if (!canSet(j, body.status, who)) { refused = true; return; }
        j.status = body.status;
      }
      if (typeof body.message === "string") j.message = body.message.slice(0, 600);
      if (who === "bot" && Array.isArray(body.preview)) j.preview = body.preview.map(cleanPassport).filter(Boolean).slice(0, 1000);
    });
    if (!job) return NextResponse.json({ error: "job not found" }, { status: 404 });
    return NextResponse.json({ job, refused }, { status: refused ? 409 : 200, ...noStore });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "update failed" }, { status: 500 });
  }
}
