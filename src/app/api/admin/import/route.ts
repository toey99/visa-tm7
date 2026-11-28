// POST /api/admin/import { prefix?, cursor?, limit? }  → { copied, skipped, failed, cursor, done }
// =============================================================
// Copies the old site's data (Vercel Blob) into the new store (Supabase), one page per call.
// Runs on the NEW deployment only: needs Supabase switched on and OLD_BLOB_READ_WRITE_TOKEN
// (a read token of the old Blob store). Safe to repeat: JSON documents are overwritten with the
// latest content, files already present with the same size are skipped. Nothing is ever written
// to or deleted from the old store.
import { NextRequest, NextResponse } from "next/server";
import { sbFileSizes, sbPut, supabaseOn } from "@/lib/store-supabase";
import { mapLimit } from "@/lib/blob";

export const runtime = "nodejs";
export const maxDuration = 300;
const OLD = "https://blob.vercel-storage.com";

export async function POST(req: NextRequest) {
  try {
    const old = process.env.OLD_BLOB_READ_WRITE_TOKEN;
    if (!supabaseOn()) return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า SUPABASE_URL / SUPABASE_SECRET_KEY ในโปรเจกต์นี้" }, { status: 400 });
    if (!old) return NextResponse.json({ error: "ยังไม่ได้ตั้งค่า OLD_BLOB_READ_WRITE_TOKEN (กุญแจอ่านของที่เก็บไฟล์ตัวเก่า)" }, { status: 400 });
    const body = (await req.json().catch(() => ({}))) as { prefix?: string; cursor?: string; limit?: number };
    const prefix = String(body.prefix ?? "").slice(0, 200);
    const limit = Math.min(300, Math.max(10, Number(body.limit) || 120));

    const u = new URL(OLD);
    u.searchParams.set("prefix", prefix);
    u.searchParams.set("limit", String(limit));
    if (body.cursor) u.searchParams.set("cursor", body.cursor);
    const lr = await fetch(u, { headers: { authorization: `Bearer ${old}`, "x-api-version": "7" }, cache: "no-store" });
    if (!lr.ok) return NextResponse.json({ error: `อ่านรายการจากตัวเก่าไม่ได้ (${lr.status})` }, { status: 502 });
    const page = (await lr.json()) as { blobs: { url: string; pathname: string; size: number }[]; cursor?: string; hasMore?: boolean };

    // files already copied (same path and size) are skipped — look them up per top folder of this page
    const have = new Map<string, number>();
    for (const top of new Set(page.blobs.filter((b) => !b.pathname.endsWith(".json")).map((b) => b.pathname.split("/").slice(0, 2).join("/") + "/"))) {
      for (const [k, v] of await sbFileSizes(top)) have.set(k, v);
    }
    let copied = 0, skipped = 0;
    const failed: string[] = [];
    await mapLimit(page.blobs, 6, async (b) => {
      try {
        const json = b.pathname.endsWith(".json");
        if (!json && have.get(b.pathname) === b.size) { skipped++; return; }
        const src = new URL(b.url);
        if (json) src.searchParams.set("cache", "0");   // the latest write, not the CDN copy
        const r = await fetch(src, { headers: { authorization: `Bearer ${old}` }, cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (json) await sbPut(b.pathname, await r.text(), "application/json");
        else await sbPut(b.pathname, await r.blob(), r.headers.get("content-type") || "application/octet-stream");
        copied++;
      } catch (e) { failed.push(`${b.pathname}: ${e instanceof Error ? e.message : String(e)}`); }
    });
    return NextResponse.json({ copied, skipped, failed: failed.slice(0, 20), failedCount: failed.length, cursor: page.hasMore ? page.cursor : null, done: !page.hasMore }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "import failed" }, { status: 500 });
  }
}
