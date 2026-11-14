// POST /api/line/send-images  multipart: ns, day (DDMMYYYY), office, caption,
//   img_<i> (PNG/JPEG full picture, ≤10 MB), prev_<i> (JPEG preview, ≤1 MB)
// → stores the pictures under the board's out/ folder and pushes them as LINE
//   image messages (caption first, then up to 5 pictures per push) to every
//   group tagged for that board. Signed-in users only (proxy).
import { NextRequest, NextResponse } from "next/server";
import { blobPut } from "@/lib/blob";
import { boardFolder } from "@/lib/day-server";
import { linePushMessages } from "@/lib/d90/line";
import { loadConfig } from "@/lib/d90/store";
import { OFFICES, type OfficeId } from "@/lib/offices";
import { signPath } from "@/lib/pub";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData();
    const ns = fd.get("ns") === "run" ? "run" : "days";
    const day = String(fd.get("day") ?? "");
    const office = String(fd.get("office") ?? "");
    const caption = String(fd.get("caption") ?? "").slice(0, 1000);
    if (!/^\d{8}$/.test(day) || !(office in OFFICES)) return NextResponse.json({ error: "day and office required" }, { status: 400 });

    const cfg = await loadConfig(true);
    const groups = Object.entries(cfg.groups).filter(([, g]) => g.status === "allowed" && g.target?.ns === ns && g.target?.office === office);
    if (!groups.length) return NextResponse.json({ error: `ยังไม่มีกลุ่ม LINE ที่ผูกกับหน้างาน ${OFFICES[office as OfficeId].label} — ตั้งกลุ่มกล่องรับงานของหน้างานนี้ก่อน` }, { status: 409 });

    const folder = `${boardFolder(ns, day, office)}out/`;
    const stampId = Date.now().toString(36);
    const images: { original: string; preview: string }[] = [];
    for (let i = 0; i < 20; i++) {
      const img = fd.get(`img_${i}`);
      if (!(img instanceof File) || !img.size) break;
      const prev = fd.get(`prev_${i}`);
      if (img.size > 10 * 1024 * 1024) return NextResponse.json({ error: `รูปที่ ${i + 1} ใหญ่เกิน 10 MB` }, { status: 413 });
      const ext = img.type === "image/png" ? "png" : "jpg";
      const full = await blobPut(`${folder}${stampId}-${i}.${ext}`, await img.arrayBuffer(), img.type || "image/png");
      const p = prev instanceof File && prev.size && prev.size <= 1024 * 1024
        ? await blobPut(`${folder}${stampId}-${i}-p.jpg`, await prev.arrayBuffer(), "image/jpeg")
        : full;
      const origin = req.nextUrl.origin;
      images.push({ original: `${origin}/api/pub?t=${signPath(full.pathname)}`, preview: `${origin}/api/pub?t=${signPath(p.pathname)}` });
    }
    if (!images.length) return NextResponse.json({ error: "no images" }, { status: 400 });

    const sent: string[] = [];
    let failure = "";
    for (const [groupId, g] of groups) {
      // caption + pictures, five messages per push
      const msgs: Array<Record<string, unknown>> = [];
      if (caption) msgs.push({ type: "text", text: caption });
      for (const im of images) msgs.push({ type: "image", originalContentUrl: im.original, previewImageUrl: im.preview });
      let ok = true;
      for (let i = 0; i < msgs.length; i += 5) {
        const r = await linePushMessages(groupId, msgs.slice(i, i + 5));
        if (!r.ok) { ok = false; failure = r.status === 429 ? "โควตาข้อความ LINE ของเดือนนี้หมดแล้ว" : `LINE ส่งไม่สำเร็จ (${r.status}) ${r.error}`; break; }
      }
      if (ok) sent.push(g.name || "กลุ่ม LINE");
    }
    if (!sent.length) return NextResponse.json({ error: failure || "ส่งเข้า LINE ไม่สำเร็จ" }, { status: 502 });
    return NextResponse.json({ ok: true, groups: sent, count: images.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 500 });
  }
}
