// POST /api/tm30/pdf  multipart: id (job), passport, file (the receipt PDF from the extension)
// → files it on that person's card on the job's board. Signed-in users only.
// GET  /api/tm30/pdf?id=<jobId>  → a 90-day (d90) job's receipts merged into ONE PDF, in the list's order
//      (&passport=<no> → that person's receipt alone)
import { NextRequest, NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { blobGetByPath } from "@/lib/blob";
import { cleanPassport, fileReceipt, readQueue, receiptPath } from "@/lib/tm30-jobs";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX = 4 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "file required" }, { status: 400 });
    if (file.size > MAX) return NextResponse.json({ error: "file too large" }, { status: 413 });
    const res = await fileReceipt(String(fd.get("id") ?? ""), String(fd.get("passport") ?? ""), await file.arrayBuffer());
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
    return NextResponse.json(res, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "upload failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get("id") ?? "";
    const job = (await readQueue()).jobs.find((j) => j.id === id);
    if (!job || job.ns !== "d90") return NextResponse.json({ error: "job not found" }, { status: 404 });
    const done = new Set(job.done ?? []);
    const one = cleanPassport(req.nextUrl.searchParams.get("passport"));
    const order = job.people.map((p) => cleanPassport(p.passportNo)).filter((p) => done.has(p) && (!one || p === one));
    if (!order.length) return NextResponse.json({ error: "no receipts yet" }, { status: 404 });

    const out = await PDFDocument.create();
    for (const passport of order) {
      const r = await blobGetByPath(receiptPath(job.id, passport), true);
      if (!r || !r.ok) continue;
      const src = await PDFDocument.load(await r.arrayBuffer());
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((pg) => out.addPage(pg));
    }
    if (!out.getPageCount()) return NextResponse.json({ error: "receipts could not be read" }, { status: 500 });
    const bytes = await out.save();
    const name = one ? `TM30_${one}.pdf` : `TM30_${order.length}_${job.day}.pdf`;
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${name}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "merge failed" }, { status: 500 });
  }
}
