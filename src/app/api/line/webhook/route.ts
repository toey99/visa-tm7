// LINE webhook for the 90-day "กล่องรับงาน" inbox group.
// POST /api/line/webhook   (public — LINE calls it; every request must carry a valid x-line-signature)
//
// • picture in an allowed group → saved, read by AI, filed as passport / slip / other, one-line reply
// • text "?name" in an allowed group → the bot answers with that customer's status
// • a group that isn't allowed yet is only remembered as "pending"; nothing it sends is stored
//   or read until someone signed in presses "อนุญาต" on /d90.
import { NextRequest, NextResponse } from "next/server";
import { blobPut } from "@/lib/blob";
import { lineGetContent, lineGroupName, lineReply, verifyLineSignature, type LineEvent } from "@/lib/d90/line";
import { readD90Image, sniffImageMime } from "@/lib/d90/ocr";
import { loadConfig, loadItems, saveConfig, saveInboxItem } from "@/lib/d90/store";
import { bkkDay, buildCases, dayLabelTh, daysWaiting, isOpen, searchCases, type D90Item } from "@/lib/d90/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const BOARD_URL = "https://tm7.toyka.net/d90";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifyLineSignature(raw, req.headers.get("x-line-signature"))) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }
  let events: LineEvent[] = [];
  try { events = ((JSON.parse(raw) as { events?: LineEvent[] }).events) ?? []; } catch { /* "Verify" sends an empty list */ }
  // Always 200 once the signature is good: a failure on our side must not make LINE resend the batch.
  await Promise.all(events.map((ev) => handle(ev).catch((e) => console.error("[line webhook]", ev.type, e))));
  return NextResponse.json({ ok: true });
}

async function handle(ev: LineEvent): Promise<void> {
  const groupId = ev.source?.type === "group" ? ev.source.groupId : undefined;
  if (!groupId) {
    if (ev.type === "message") await lineReply(ev.replyToken, "บอทนี้ทำงานในกลุ่ม “กล่องรับงาน” เท่านั้นค่ะ");
    return;
  }

  if (ev.type === "leave") {
    const cfg = await loadConfig(true);
    if (cfg.groups[groupId]) { delete cfg.groups[groupId]; await saveConfig(cfg); }
    return;
  }

  let cfg = await loadConfig();
  if (cfg.groups[groupId]?.status !== "allowed") cfg = await loadConfig(true); // just approved on the board?
  if (cfg.groups[groupId]?.status !== "allowed") {
    const known = !!cfg.groups[groupId];
    if (!known) {
      cfg.groups[groupId] = { name: await lineGroupName(groupId), status: "pending", ts: Date.now() };
      await saveConfig(cfg);
    }
    if (ev.type === "join" || !known) {
      await lineReply(ev.replyToken, `สวัสดีค่ะ 📥 กลุ่มนี้ยังไม่ได้รับอนุญาต\nเปิด ${BOARD_URL} แล้วกด “อนุญาตกลุ่มนี้” ก่อนนะคะ จากนั้นส่งรูปเข้ามาได้เลย`);
    }
    return;
  }

  if (ev.type !== "message" || !ev.message) return;
  if (ev.message.type === "image") return handleImage(ev, groupId);
  if (ev.message.type === "text") return handleText(ev);
}

async function handleImage(ev: LineEvent, groupId: string): Promise<void> {
  const m = ev.message!;
  if (m.contentProvider && m.contentProvider.type !== "line") return;
  const bytes = await lineGetContent(m.id);
  const mime = sniffImageMime(new Uint8Array(bytes.slice(0, 16)));
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const ts = ev.timestamp || Date.now();
  const img = `d90/img/${bkkDay(ts).slice(0, 7).replace("-", "")}/${m.id}.${ext}`;
  await blobPut(img, bytes, mime);

  const item: D90Item = { id: m.id, ts, kind: "other", img, groupId, setId: m.imageSet?.id, name: "", passportNo: "", nationality: "", nextDue: "" };
  let failed = false;
  try {
    Object.assign(item, await readD90Image(bytes, mime));
  } catch (e) {
    failed = true;
    item.note = "AI อ่านไม่สำเร็จ";
    console.error("[line webhook] read failed", m.id, e);
  }
  await saveInboxItem(item);

  // one short line per picture that matters; extra pages stay silent
  if (failed) return lineReply(ev.replyToken, `⚠️ อ่านรูปนี้ไม่สำเร็จ — เก็บรูปไว้แล้ว แก้เองได้ที่ ${BOARD_URL}`);
  if (item.kind === "passport") {
    return lineReply(ev.replyToken, item.name ? `📥 รับงาน: ${item.name}${item.passportNo ? ` · ${item.passportNo}` : ""}` : `⚠️ เป็นหน้า passport แต่อ่านชื่อไม่ออก — แก้ชื่อได้ที่ ${BOARD_URL}`);
  }
  if (item.kind === "slip") {
    return lineReply(ev.replyToken, `✅ ใบ 90 วัน: ${item.name || "(อ่านชื่อไม่ออก)"}${item.nextDue ? ` · ครั้งถัดไป ${item.nextDue}` : ""}`);
  }
}

async function handleText(ev: LineEvent): Promise<void> {
  const text = (ev.message?.text ?? "").trim();
  if (!/^[?？]/.test(text)) return; // only answers when asked: "?li zhong"
  const q = text.slice(1).trim();
  const board = buildCases(await loadItems());
  const now = Date.now();
  if (!q) {
    const open = board.cases.filter(isOpen);
    return lineReply(ev.replyToken, `⏳ รอใบอยู่ ${open.length} คน${board.orphanSlips.length ? ` · ใบที่ยังไม่จับคู่ ${board.orphanSlips.length}` : ""}\n${BOARD_URL}`);
  }
  const hits = searchCases(board, q).slice(-5).reverse();
  if (!hits.length) return lineReply(ev.replyToken, `ไม่พบ “${q}” ในบอร์ด 90 วัน`);
  const lines = hits.map((c) => {
    const p = c.passport;
    const head = `${p.name || "(ไม่มีชื่อ)"}${p.passportNo ? ` · ${p.passportNo}` : ""}\nรับงาน ${dayLabelTh(bkkDay(p.ts))}`;
    if (c.slip) return `✅ ${head}\nได้ใบแล้ว ${dayLabelTh(bkkDay(c.slip.ts))}${c.slip.nextDue ? ` · ครั้งถัดไป ${c.slip.nextDue}` : ""}`;
    if (p.done) return `☑️ ${head}\nปิดงานแล้ว`;
    return `⏳ ${head}\nยังไม่ได้ใบ (รอมา ${daysWaiting(p.ts, now)} วัน)`;
  });
  return lineReply(ev.replyToken, lines.join("\n\n"));
}
