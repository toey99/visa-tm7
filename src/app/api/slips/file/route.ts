// GET /api/slips/file?path=slips/<BOOK>/img/YYYYMM/<messageId>.jpg → the slip picture (signed-in users only; the proxy gates this route)
import { NextRequest, NextResponse } from "next/server";
import { blobGetByPath } from "@/lib/blob";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const path = req.nextUrl.searchParams.get("path") ?? "";
  if (!/^slips\/[A-Z][A-Z0-9_]*\/img\/\d{6}\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(path)) return NextResponse.json({ error: "bad path" }, { status: 400 });
  try {
    const r = await blobGetByPath(path);
    if (!r || !r.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    const type = path.endsWith(".png") ? "image/png" : path.endsWith(".webp") ? "image/webp" : "image/jpeg";
    return new NextResponse(r.body, { status: 200, headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "read failed" }, { status: 500 });
  }
}
