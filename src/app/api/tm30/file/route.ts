// GET /api/tm30/file?id=<jobId> → the job's TM.30 upload Excel (for the extension). Signed-in users only.
import { NextRequest, NextResponse } from "next/server";
import { blobGetByPath } from "@/lib/blob";
import { xlsPath } from "@/lib/tm30-jobs";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^j[a-z0-9]{6,24}$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  try {
    const r = await blobGetByPath(xlsPath(id), true);
    if (!r || !r.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return new NextResponse(r.body, { status: 200, headers: { "Content-Type": "application/vnd.ms-excel", "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "read failed" }, { status: 500 });
  }
}
