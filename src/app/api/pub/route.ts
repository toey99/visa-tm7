// GET /api/pub?t=<signed token> → a board output picture (summary, car card…)
// Public on purpose: LINE downloads image messages without any sign-in. Only
// signed tokens for files under <board>/out/ resolve (see src/lib/pub.ts).
import { NextRequest, NextResponse } from "next/server";
import { blobGetByPath } from "@/lib/blob";
import { verifyToken } from "@/lib/pub";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const path = verifyToken(req.nextUrl.searchParams.get("t") ?? "");
  if (!path) return NextResponse.json({ error: "not found" }, { status: 404 });
  try {
    const r = await blobGetByPath(path);
    if (!r || !r.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    const type = /\.png$/i.test(path) ? "image/png" : "image/jpeg";
    return new NextResponse(r.body, { status: 200, headers: { "Content-Type": type, "Cache-Control": "public, max-age=604800, immutable" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "read failed" }, { status: 500 });
  }
}
