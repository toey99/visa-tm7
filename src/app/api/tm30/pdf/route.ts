// POST /api/tm30/pdf  multipart: id (job), passport, file (the receipt PDF from the extension)
// → files it on that person's card on the job's board. Signed-in users only.
import { NextRequest, NextResponse } from "next/server";
import { fileReceipt } from "@/lib/tm30-jobs";

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
