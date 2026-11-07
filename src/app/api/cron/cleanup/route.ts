// Weekly purge, scheduled in vercel.json for Sunday 23:00 Bangkok (16:00 UTC):
// deletes every day folder (extension board days/ and visa-run board run/)
// dated on or before that Sunday, so Monday starts
// clean. Bills under bills/ are never touched here. Vercel calls this with
// "Authorization: Bearer <CRON_SECRET>".
import { NextRequest, NextResponse } from "next/server";
import { blobDelete, blobList } from "@/lib/blob";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    // "today" in Bangkok
    const now = new Date(Date.now() + 7 * 3600 * 1000);
    const todayKey = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}${String(now.getUTCDate()).padStart(2, "0")}`;
    const blobs = [...(await blobList("days/")), ...(await blobList("run/"))];
    const victims = blobs.filter((b) => {
      const m = b.pathname.match(/^(?:days|run)\/(\d{2})(\d{2})(\d{4})\//);
      if (!m) return false;
      const key = `${m[3]}${m[2]}${m[1]}`;
      return key <= todayKey;
    });
    if (victims.length) await blobDelete(victims.map((b) => b.url));
    return NextResponse.json({ ok: true, deleted: victims.length, upTo: todayKey });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "cleanup failed" }, { status: 500 });
  }
}
