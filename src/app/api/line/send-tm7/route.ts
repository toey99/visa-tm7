// POST /api/line/send-tm7  multipart: ns, day (DDMMYYYY), office, personId, name, cn, file (the person's TM.7 PDF)
// → keeps the PDF next to the person on the board and pushes a download link
//   to the LINE group(s) tagged for that board. Signed-in users only (proxy).
//
// LINE bots cannot attach files, so the group gets a link. The link is this
// app's own gated file route: only the signed-in accounts can open it.
// openExternalBrowser=1 makes LINE open it in the phone's browser (where the
// Google sign-in lives) instead of LINE's in-app browser.
import { NextRequest, NextResponse } from "next/server";
import { blobPut } from "@/lib/blob";
import { boardFolder, safeId } from "@/lib/day-server";
import { linePush } from "@/lib/d90/line";
import { loadConfig } from "@/lib/d90/store";
import { OFFICES, type OfficeId } from "@/lib/offices";

export const runtime = "nodejs";
const MAX = 15 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData();
    const ns = fd.get("ns") === "run" ? "run" : "days";
    const day = String(fd.get("day") ?? "");
    const office = String(fd.get("office") ?? "");
    const personId = safeId(String(fd.get("personId") ?? ""));
    const file = fd.get("file");
    if (!/^\d{8}$/.test(day) || !(office in OFFICES) || !personId) return NextResponse.json({ error: "day, office and personId required" }, { status: 400 });
    if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "file required" }, { status: 400 });
    if (file.size > MAX) return NextResponse.json({ error: "file too large" }, { status: 413 });
    const bytes = await file.arrayBuffer();
    const head = new Uint8Array(bytes.slice(0, 4));
    if (!(head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46)) return NextResponse.json({ error: "not a PDF" }, { status: 400 });

    const cfg = await loadConfig(true);
    const groups = Object.entries(cfg.groups).filter(([, g]) => g.status === "allowed" && g.target?.ns === ns && g.target?.office === office);
    if (!groups.length) {
      return NextResponse.json({ error: `ยังไม่มีกลุ่ม LINE ที่ผูกกับหน้างาน ${OFFICES[office as OfficeId].label} — ตั้งกลุ่มกล่องรับงานของหน้างานนี้ก่อน` }, { status: 409 });
    }

    const info = await blobPut(`${boardFolder(ns, day, office)}${personId}/tm7.pdf`, bytes, "application/pdf");
    const url = `${req.nextUrl.origin}/api/day/file?path=${encodeURIComponent(info.pathname)}&v=${Date.now().toString(36)}&openExternalBrowser=1`;
    const name = String(fd.get("name") ?? "").slice(0, 80);
    const cn = String(fd.get("cn") ?? "").slice(0, 20);
    const date = `${day.slice(0, 2)}/${day.slice(2, 4)}/${day.slice(4)}`;
    const text = `📄 TM7 ${name}${cn ? ` ${cn}` : ""}\n${OFFICES[office as OfficeId].label} · ${date}\n${url}\n(เปิดได้เฉพาะเครื่องที่ login tm7.toyka.net)`;

    const sent: string[] = [];
    let failure = "";
    for (const [groupId, g] of groups) {
      const r = await linePush(groupId, text);
      if (r.ok) sent.push(g.name || "กลุ่ม LINE");
      else failure = r.status === 429 ? "โควตาข้อความ LINE ของเดือนนี้หมดแล้ว" : `LINE ส่งไม่สำเร็จ (${r.status}) ${r.error}`;
    }
    if (!sent.length) return NextResponse.json({ error: failure || "ส่งเข้า LINE ไม่สำเร็จ" }, { status: 502 });
    return NextResponse.json({ ok: true, groups: sent }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "send failed" }, { status: 500 });
  }
}
