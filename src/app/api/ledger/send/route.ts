// POST /api/ledger/send  multipart: book, day (YYYY-MM-DD), img (PNG), prev (JPEG preview, optional)
// → stores the closing-note picture under ledger/<BOOK>/out/ and pushes it as a
//   LINE image message to the book's configured group. Signed-in users only (proxy).
import { NextRequest, NextResponse } from "next/server";
import { blobPut } from "@/lib/blob";
import { linePushMessages } from "@/lib/d90/line";
import { loadLedgerConfig, safeDay } from "@/lib/ledger/server";
import { isLedgerBook } from "@/lib/ledger/types";
import { signPath } from "@/lib/pub";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData();
    const book = String(fd.get("book") ?? "ARTAO");
    const day = safeDay(fd.get("day"));
    if (!isLedgerBook(book) || !day) return NextResponse.json({ error: "book and day required" }, { status: 400 });
    const cfg = await loadLedgerConfig(book);
    if (!cfg.lineGroupId) return NextResponse.json({ error: "ยังไม่ได้เลือกกลุ่ม LINE สำหรับส่งยอด — เลือกในส่วน ⚙️ ก่อน" }, { status: 409 });
    const img = fd.get("img");
    if (!(img instanceof File) || !img.size) return NextResponse.json({ error: "no image" }, { status: 400 });
    if (img.size > 10 * 1024 * 1024) return NextResponse.json({ error: "รูปใหญ่เกิน 10 MB" }, { status: 413 });

    const id = `${day}-${Date.now().toString(36)}`;
    const full = await blobPut(`ledger/${book}/out/${id}.png`, await img.arrayBuffer(), "image/png");
    const prev = fd.get("prev");
    const p = prev instanceof File && prev.size && prev.size <= 1024 * 1024
      ? await blobPut(`ledger/${book}/out/${id}-p.jpg`, await prev.arrayBuffer(), "image/jpeg")
      : full;
    const origin = req.nextUrl.origin;
    const r = await linePushMessages(cfg.lineGroupId, [
      { type: "image", originalContentUrl: `${origin}/api/pub?t=${signPath(full.pathname)}`, previewImageUrl: `${origin}/api/pub?t=${signPath(p.pathname)}` },
    ]);
    if (!r.ok) return NextResponse.json({ error: r.status === 429 ? "โควตาข้อความ LINE ของเดือนนี้หมดแล้ว" : `LINE ส่งไม่สำเร็จ (${r.status}) ${r.error}` }, { status: 502 });
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 500 });
  }
}
