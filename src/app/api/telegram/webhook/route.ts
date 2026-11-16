// =============================================================
// Telegram counter bot (@ToeyVisaBot) — POST /api/telegram/webhook
// =============================================================
// The same counter commands as the LINE groups (src/lib/inbox/commands.ts),
// but for the owners only: no message quota, pictures sent straight from the
// server, and tap buttons under every card.
//   มา it1 · สด 4500 non2 · ย 17/11 it4 · ?it1 · สรุป it · รูป it อาเต่า
//   /board it → this chat's default board (bare numbers go there) · /help
// Who may talk to it: telegram/config.json { users: { <id>: {name, status} } }.
// The very first person to write becomes the owner; everyone after is
// "pending" until an owner sends /allow <id>.
import { NextRequest, NextResponse } from "next/server";
import { blobGetJson, blobPut } from "@/lib/blob";
import { targetDate, type InboxTarget } from "@/lib/inbox/board";
import { boardByPrefix, findPerson, parsePersonCommand, readBoard, runOnPerson, runPersonCommand, statusLine, type CommandResult, type Verb } from "@/lib/inbox/commands";
import { boardSummary } from "@/lib/inbox/board";
import { OFFICES, type OfficeId } from "@/lib/offices";
import { renderSummaryPng } from "@/lib/summary/render";
import { tgAnswerCallback, tgEditMessageText, tgSendMessage, tgSendPhoto, webhookSecret, type InlineButton, type TgMessage, type TgUpdate, type TgUser } from "@/lib/telegram/api";
import { MAIN_AGENTS } from "@/lib/today/agents";

export const runtime = "nodejs";
export const maxDuration = 60;

type TgConfig = { users: Record<string, { name: string; status: "owner" | "allowed" | "pending"; ts: number }> };
type ChatPrefs = { board?: InboxTarget; autoPic?: boolean };
const CFG = "telegram/config.json";
const prefsPath = (chatId: number) => `telegram/chats/${chatId}.json`;
const DEFAULT_BOARD: InboxTarget = { ns: "days", office: "BANGKOK" };
const nameOf = (u?: TgUser) => [u?.first_name, u?.last_name].filter(Boolean).join(" ") || (u?.username ? `@${u.username}` : String(u?.id ?? ""));

const HELP = [
  "🤖 ToeyVisaBot — สั่งงานบนบอร์ดจากแชทนี้",
  "",
  "หน้างาน: it · non · r · vfs · vfsp · cs (วีซ่ารัน)",
  "• มา it1 · มา it1 it3 · มา it1-4 · ไม่มา it2",
  "• สด 4500 it1 · โอน 4500 it1 · รอ it1 · ยังไม่จ่าย it1 · เก็บ 4500 it1",
  "• vip it1 · ไม่vip it1 · ย 17/11 it1 · ยก it2 · คืน it2",
  "• ?it1 · ?it1-5 · ?LI KAI → การ์ด (มีปุ่มกดใต้ข้อความ)",
  "• สรุป it · สรุป non 17/11 → รายชื่อ",
  "• รูป it · รูป it อาเต่า · รูป cs → รูป Summary",
  "• เลขเปล่า (มา 1) = หน้างานตั้งต้นของแชทนี้ → เปลี่ยนด้วย /board non",
  "• /pic off | on → รูป Summary อัตโนมัติหลังทุกคำสั่ง",
  "• /allow <id> → อนุญาตคนใหม่ · /users → รายชื่อ",
].join("\n");

export async function POST(req: NextRequest) {
  if (req.headers.get("x-telegram-bot-api-secret-token") !== webhookSecret()) return NextResponse.json({ error: "bad secret" }, { status: 401 });
  let upd: TgUpdate;
  try { upd = (await req.json()) as TgUpdate; } catch { return NextResponse.json({ ok: true }); }
  try {
    if (upd.callback_query) await handleCallback(upd.callback_query);
    else if (upd.message) await handleMessage(upd.message);
  } catch (e) {
    console.error("[telegram]", e);
    const chatId = upd.message?.chat.id ?? upd.callback_query?.message?.chat.id;
    if (chatId) await tgSendMessage(chatId, `⚠️ ทำไม่สำเร็จ (${e instanceof Error ? e.message.slice(0, 160) : "error"})`);
  }
  return NextResponse.json({ ok: true });   // always 200: Telegram retries otherwise
}

// ---------- access ----------
async function loadCfg(): Promise<TgConfig> { return (await blobGetJson<TgConfig>(CFG)) ?? { users: {} }; }
async function saveCfg(c: TgConfig) { await blobPut(CFG, JSON.stringify(c), "application/json"); }

/** true when this user may give commands; otherwise they get a note with their id and false. */
async function allowed(user: TgUser | undefined, chatId: number): Promise<boolean> {
  if (!user) return false;
  const cfg = await loadCfg();
  const me = cfg.users[String(user.id)];
  if (me?.status === "owner" || me?.status === "allowed") return true;
  if (!Object.values(cfg.users).some((u) => u.status === "owner")) {
    cfg.users[String(user.id)] = { name: nameOf(user), status: "owner", ts: Date.now() };   // first contact = owner
    await saveCfg(cfg);
    await tgSendMessage(chatId, `👋 สวัสดี ${nameOf(user)} — ตั้งคุณเป็นเจ้าของบอทแล้ว (id ${user.id})\nคนอื่นที่ทักมา ให้คุณพิมพ์ /allow <id> เพื่ออนุญาต\n\n${HELP}`);
    return true;
  }
  if (!me) { cfg.users[String(user.id)] = { name: nameOf(user), status: "pending", ts: Date.now() }; await saveCfg(cfg); }
  await tgSendMessage(chatId, `⛔ ยังไม่ได้รับอนุญาต — ส่งเลขนี้ให้เจ้าของบอท: ${user.id}`);
  return false;
}

async function loadPrefs(chatId: number): Promise<ChatPrefs> { return (await blobGetJson<ChatPrefs>(prefsPath(chatId))) ?? {}; }
async function savePrefs(chatId: number, p: ChatPrefs) { await blobPut(prefsPath(chatId), JSON.stringify(p), "application/json"); }

const filingDay = (t: InboxTarget, ts: number) => targetDate(ts, t, {}).replace(/\//g, "");
const boardLabel = (t: InboxTarget) => `${t.ns === "run" ? "🚗 " : ""}${OFFICES[t.office].label}`;

// ---------- messages ----------
async function handleMessage(m: TgMessage): Promise<void> {
  const chatId = m.chat.id;
  const text = (m.text ?? m.caption ?? "").trim();
  if (!text) return;
  if (!(await allowed(m.from, chatId))) return;
  const ts = m.date * 1000;
  const prefs = await loadPrefs(chatId);
  const board = prefs.board ?? DEFAULT_BOARD;

  // slash commands
  const slash = text.match(/^\/(\w+)(?:@\w+)?(?:\s+(.*))?$/);
  if (slash) {
    const [, cmd, arg = ""] = slash;
    if (cmd === "start" || cmd === "help") return void (await tgSendMessage(chatId, HELP));
    if (cmd === "board") {
      const t = boardByPrefix(arg.trim());
      if (!t) return void (await tgSendMessage(chatId, `หน้างานตั้งต้นตอนนี้: ${boardLabel(board)}\nเปลี่ยน: /board it · non · r · vfs · vfsp · cs`));
      await savePrefs(chatId, { ...prefs, board: t });
      return void (await tgSendMessage(chatId, `✅ เลขเปล่า ๆ ในแชทนี้ = ${boardLabel(t)}`));
    }
    if (cmd === "pic") {
      const on = !/off|ปิด/i.test(arg);
      await savePrefs(chatId, { ...prefs, autoPic: on });
      return void (await tgSendMessage(chatId, on ? "🖼 ส่งรูป Summary อัตโนมัติหลังทุกคำสั่ง" : "🔕 ปิดรูปอัตโนมัติ — ขอเองด้วย “รูป it อาเต่า”"));
    }
    if (cmd === "allow" || cmd === "deny") {
      const cfg = await loadCfg();
      const me = cfg.users[String(m.from?.id)];
      if (me?.status !== "owner") return void (await tgSendMessage(chatId, "เฉพาะเจ้าของบอท"));
      const id = arg.trim();
      if (!/^\d+$/.test(id)) return void (await tgSendMessage(chatId, "ใช้: /allow <id>"));
      cfg.users[id] = { name: cfg.users[id]?.name ?? id, status: cmd === "allow" ? "allowed" : "pending", ts: Date.now() };
      await saveCfg(cfg);
      return void (await tgSendMessage(chatId, `${cmd === "allow" ? "✅ อนุญาต" : "⛔ ถอน"} ${cfg.users[id].name} (${id}) แล้ว`));
    }
    if (cmd === "users") {
      const cfg = await loadCfg();
      return void (await tgSendMessage(chatId, Object.entries(cfg.users).map(([id, u]) => `${u.status === "owner" ? "👑" : u.status === "allowed" ? "✅" : "⏳"} ${u.name} · ${id}`).join("\n") || "ยังไม่มีใคร"));
    }
    return void (await tgSendMessage(chatId, HELP));
  }

  if (/^(ช่วย|help|\?)$/i.test(text)) return void (await tgSendMessage(chatId, HELP));

  // สรุป [board] [date]
  const sm = text.match(/^(?:สรุป|summary)(?:\s+([a-zA-Zรัน]+))?(?:\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?)?$/);
  if (sm) {
    const t = (sm[1] && boardByPrefix(sm[1])) || board;
    const date = sm[2] ? `${sm[2].padStart(2, "0")}/${sm[3].padStart(2, "0")}/${yearOf(sm[4], ts)}` : targetDate(ts, t, {});
    return void (await tgSendMessage(chatId, await boardSummary(t, date)));
  }

  // รูป [board] [agent]
  const pm = text.match(/^(?:รูป|รูปสรุป|สรุปรูป|pic)(?:\s+(.+))?$/i);
  if (pm) {
    const toks = (pm[1] ?? "").trim().split(/\s+/).filter(Boolean);
    const t = toks[0] && boardByPrefix(toks[0]) ? boardByPrefix(toks.shift()!)! : board;
    const typed = toks.join(" ");
    const agent = typed ? (MAIN_AGENTS.find((a) => a.toLowerCase() === typed.toLowerCase()) ?? typed) : "";
    return sendPicture(chatId, t, filingDay(t, ts), agent);
  }

  // verb + name / queue number
  const pc = parsePersonCommand(text, ts);
  if (!pc) return;   // ordinary chatter
  const r = await runPersonCommand(pc, board, ts, filingDay(pc.board ?? board, ts));
  await reportResult(chatId, r, prefs, pc.verb === "status" ? await buttonsFor(pc.board ?? board, pc, ts) : undefined);
}

function yearOf(yy: string | undefined, ts: number): number {
  if (!yy) return new Date(ts + 7 * 3600 * 1000).getUTCFullYear();
  return yy.length === 2 ? 2000 + Number(yy) : Number(yy) > 2400 ? Number(yy) - 543 : Number(yy);
}

// tap buttons under a status reply: one row per person shown
async function buttonsFor(t: InboxTarget, pc: ReturnType<typeof parsePersonCommand>, ts: number): Promise<InlineButton[][] | undefined> {
  if (!pc) return undefined;
  const { hits } = await findPerson(t, pc.query, ts, filingDay(t, ts));
  if (!hits.length || hits.length > 4) return undefined;
  return hits.map((h) => {
    const k = (verb: Verb, label: string): InlineButton => ({ text: label, callback_data: ["c", t.ns, t.office, h.day, h.rec.id, verb].join("|").slice(0, 64) });
    const short = hits.length > 1 ? `${h.all.filter((x) => !x.cancelled && !x.movedTo).indexOf(h.rec) + 1} ` : "";
    return [k("arrive", `${short}✅ มา`), k("cash", `${short}💵 สด`), k("transfer", `${short}🏦 โอน`), k("waiting", `${short}🕓 รอ`), k("cancel", `${short}🚫 ยก`)];
  });
}

async function reportResult(chatId: number, r: CommandResult, prefs: ChatPrefs, buttons?: InlineButton[][]): Promise<void> {
  await tgSendMessage(chatId, r.text, { buttons });
  if (r.changed && prefs.autoPic !== false) {
    for (const agent of r.changed.agents.slice(0, 3)) await sendPicture(chatId, r.changed.target, r.changed.day, agent);
  }
}

async function sendPicture(chatId: number, t: InboxTarget, dayKey: string, agent: string): Promise<void> {
  try {
    const r = await renderSummaryPng(t, dayKey, agent);
    const date = `${dayKey.slice(0, 2)}/${dayKey.slice(2, 4)}/${dayKey.slice(4)}`;
    const res = await tgSendPhoto(chatId, r.png, `summary_${dayKey}${agent ? "_" + agent : ""}.png`, `📋 ${boardLabel(t)} ${date}${agent ? ` · 🏢 ${agent}` : ""} · ${r.count} คน`);
    if (!res.ok) await tgSendMessage(chatId, `⚠️ ส่งรูปไม่สำเร็จ: ${res.error}`);
  } catch (e) {
    await tgSendMessage(chatId, `⚠️ ทำรูป summary ไม่สำเร็จ: ${e instanceof Error ? e.message.slice(0, 160) : "error"}`);
  }
}

// ---------- tapped buttons ----------
async function handleCallback(q: NonNullable<TgUpdate["callback_query"]>): Promise<void> {
  const chatId = q.message?.chat.id;
  if (!chatId) return void (await tgAnswerCallback(q.id));
  if (!(await allowed(q.from, chatId))) return void (await tgAnswerCallback(q.id, "ยังไม่ได้รับอนุญาต"));
  const [kind, ns, office, day, id, verb] = (q.data ?? "").split("|");
  if (kind !== "c" || !(office in OFFICES) || !/^\d{8}$/.test(day) || !id || !verb) return void (await tgAnswerCallback(q.id));
  const t: InboxTarget = { ns: ns === "run" ? "run" : "days", office: office as OfficeId };
  const r = await runOnPerson(verb as Verb, t, day, id);
  await tgAnswerCallback(q.id, r.text.split("\n")[0].slice(0, 180));
  // refresh the card under the buttons so the state is visible without scrolling
  const { all } = await readBoard(t, day);
  const rec = all.find((p) => p.id === id);
  if (rec && q.message) {
    const k = (v: Verb, label: string): InlineButton => ({ text: label, callback_data: ["c", t.ns, t.office, day, id, v].join("|").slice(0, 64) });
    await tgEditMessageText(chatId, q.message.message_id, `${statusLine(rec, all)}\n📅 ${boardLabel(t)} ${day.slice(0, 2)}/${day.slice(2, 4)}/${day.slice(4)}`, [[k("arrive", "✅ มา"), k("cash", "💵 สด"), k("transfer", "🏦 โอน"), k("waiting", "🕓 รอ"), k("cancel", "🚫 ยก")]]);
  }
  const prefs = await loadPrefs(chatId);
  if (r.changed && prefs.autoPic !== false) for (const agent of r.changed.agents) await sendPicture(chatId, t, day, agent);
}
