// POST /api/day/file  multipart: date, path (relative under the day), file → {path}
// GET  /api/day/file?path=days/DDMMYYYY/<person>/<file>  → the bytes (signed-in users only; the proxy gates this route)
// DELETE /api/day/file?path=...
import { NextRequest, NextResponse } from "next/server";
import { blobDelete, blobGetByPath, blobList, blobPut } from "@/lib/blob";

export const runtime = "nodejs";
const MAX = 15 * 1024 * 1024;

function safePath(p: string): string | null {
  return /^(?:days|run)\/\d{8}\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(p) ? p : null;
}

export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData();
    const path = safePath(String(fd.get("path") ?? ""));
    const file = fd.get("file");
    if (!path || !(file instanceof File)) return NextResponse.json({ error: "path and file required" }, { status: 400 });
    if (file.size > MAX) return NextResponse.json({ error: "file too large" }, { status: 413 });
    const info = await blobPut(path, file, file.type || "application/octet-stream");
    return NextResponse.json({ path: info.pathname, size: info.size });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "upload failed" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const path = safePath(req.nextUrl.searchParams.get("path") ?? "");
  if (!path) return NextResponse.json({ error: "bad path" }, { status: 400 });
  try {
    const r = await blobGetByPath(path);
    if (!r || !r.ok) return NextResponse.json({ error: "not found" }, { status: 404 });
    return new NextResponse(r.body, {
      status: 200,
      headers: { "Content-Type": r.headers.get("content-type") ?? "application/octet-stream", "Cache-Control": "private, max-age=3600" },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "read failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const path = safePath(req.nextUrl.searchParams.get("path") ?? "");
  if (!path) return NextResponse.json({ error: "bad path" }, { status: 400 });
  try {
    const found = (await blobList(path)).filter((b) => b.pathname === path);
    if (found.length) await blobDelete(found.map((b) => b.url));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "delete failed" }, { status: 500 });
  }
}
