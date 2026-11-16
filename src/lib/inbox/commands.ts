// =============================================================
// LINE → day board: counter commands on one person (server only)
// =============================================================
// Typed in a group tagged for a board, a verb + a name acts on that person's
// card the same way a tap on the board would:
//   มาแล้ว LI KAI        → ✅ arrived          ไม่มา LI          → arrived off
//   จ่ายสด 4500 LI       → 💵 cash received   โอน 4500 LI       → 🏦 transfer received
//   รอโอน LI             → 🕓 will transfer    ยังไม่จ่าย LI     → back to pending
//   เก็บ 4500 LI         → amount to collect  vip LI / ไม่vip LI
//   ย้าย 17/11 LI        → reschedule (ghost kept, copy on the other day)
//   ยกเลิก LI            → no-show / cancelled   คืน LI → un-cancel
//   สถานะ LI  (or ?LI)   → the card in one message
// The person is looked up on today's board first, then on the board the group
// is currently filing to (after 17:00 that is the next working day). Writes go
// through the same merge as the app, with the loaded record as the base, so a
// phone editing the same card at the same moment loses nothing.
import { blobGetByPath, blobPut } from "@/lib/blob";
import { boardFolder, loadManifest, readRecords, saveToBoard, type PersonRec } from "@/lib/day-server";
import { OFFICES } from "@/lib/offices";
import type { PersonFields } from "@/lib/today/types";
import type { InboxTarget } from "./board";

const BKK = 7 * 3600 * 1000;
const pad = (n: number) => String(n).padStart(2, "0");
const todayKey = (ts: number) => { const d = new Date(ts + BKK); return `${pad(d.getUTCDate())}${pad(d.getUTCMonth() + 1)}${d.getUTCFullYear()}`; };
const keyToDate = (k: string) => `${k.slice(0, 2)}/${k.slice(2, 4)}/${k.slice(4)}`;
const fieldsOf = (p: PersonRec) => (p.fields ?? {}) as Partial<PersonFields>;
export const nameOf = (p: PersonRec) => { const f = fieldsOf(p); return [f.lastName, f.firstName].filter(Boolean).join(" ") || f.chineseName || f.passportNo || p.id; };
const money = (v: unknown) => Number(String(v ?? "").replace(/[^\d.]/g, "")).toLocaleString("en-US");

type Verb = "arrive" | "unarrive" | "cash" | "transfer" | "waiting" | "pending" | "collect" | "vip" | "novip" | "move" | "cancel" | "uncancel" | "status";
const VERBS: [RegExp, Verb][] = [
  [/^(มาแล้ว|ถึงแล้ว|ถึง|มา|เช็คอิน|checkin|arrived?)$/i, "arrive"],
  [/^(ยังไม่มา|ไม่มา|unarrive)$/i, "unarrive"],
  [/^(จ่ายสด|สด|เงินสด|cash)$/i, "cash"],
  [/^(โอน|โอนแล้ว|จ่ายโอน|transfer)$/i, "transfer"],
  [/^(รอโอน|รอ|waiting)$/i, "waiting"],
  [/^(ยังไม่จ่าย|ค้าง|pending)$/i, "pending"],
  [/^(เก็บ|collect)$/i, "collect"],
  [/^vip$/i, "vip"],
  [/^(ไม่vip|novip|-vip)$/i, "novip"],
  [/^(ย้าย|เลื่อน|ย|move)$/i, "move"],
  [/^(ยกเลิก|ยก|cancel|no-?show)$/i, "cancel"],
  [/^(คืน|เอากลับ|uncancel)$/i, "uncancel"],
  [/^(สถานะ|เช็ค|check|status)$/i, "status"],
];

export type PersonCommand = { verb: Verb; amount?: string; date?: string; query: string[]; board?: InboxTarget };

// office prefixes on a queue number — it1 · non2 · r1 / ray1 · vfs1 · vfsp1 (Pattaya) · cs1 / run1 (visa run)
const OFFICE_PREFIX: Record<string, InboxTarget> = {
  it: { ns: "days", office: "BANGKOK" }, bkk: { ns: "days", office: "BANGKOK" },
  non: { ns: "days", office: "NONTHABURI" }, nb: { ns: "days", office: "NONTHABURI" },
  r: { ns: "days", office: "RAYONG" }, ray: { ns: "days", office: "RAYONG" },
  vfs: { ns: "days", office: "VFS_BANGKOK" }, vfsb: { ns: "days", office: "VFS_BANGKOK" }, vfsp: { ns: "days", office: "VFS_PATTAYA" },
  cs: { ns: "run", office: "CHIANG_SAEN" }, run: { ns: "run", office: "CHIANG_SAEN" }, รัน: { ns: "run", office: "CHIANG_SAEN" },
};
const PREFIX_RE = new RegExp(`^(${Object.keys(OFFICE_PREFIX).join("|")})(\\d{1,2}(?:-\\d{1,2})?(?:,\\d{1,2}(?:-\\d{1,2})?)*)$`, "i");
/** Board named by a prefix ("it", "non", "r"…) on its own, e.g. "สรุป it". */
export const boardByPrefix = (s: string): InboxTarget | undefined => OFFICE_PREFIX[s.toLowerCase()];

/** Parse "verb [amount|date] name…" — null when the text is not such a command (no verb, or no name after it). */
export function parsePersonCommand(text: string, ts: number): PersonCommand | null {
  let t = text.trim();
  if (!t) return null;
  let verb: Verb | null = null;
  if (/^[?？]/.test(t)) { verb = "status"; t = t.slice(1).trim(); }
  const toks = t.split(/\s+/);
  if (!verb) {
    const hit = VERBS.find(([re]) => re.test(toks[0]));
    if (!hit) return null;
    verb = hit[1]; toks.shift();
  }
  let amount: string | undefined;
  let date: string | undefined;
  if ((verb === "cash" || verb === "transfer" || verb === "collect") && toks[0] && /^\d{3,6}$/.test(toks[0].replace(/,/g, ""))) amount = String(Number(toks.shift()!.replace(/,/g, "")));
  if (verb === "move") {
    const m = toks[0]?.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (!m) return null;
    toks.shift();
    const now = new Date(ts + BKK);
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]) > 2400 ? Number(m[3]) - 543 : Number(m[3])) : now.getUTCFullYear();
    date = `${pad(Number(m[1]))}/${pad(Number(m[2]))}/${y}`;
  }
  // "it1", "non2-4": the first prefix picks the board, the numbers stay as queue positions
  let board: InboxTarget | undefined;
  const query = toks.filter(Boolean).map((tok) => {
    const m = tok.match(PREFIX_RE);
    if (!m) return tok;
    board ??= OFFICE_PREFIX[m[1].toLowerCase()];
    return m[2];
  });
  if (!query.length) return null;                      // a bare "เก็บ" / "vip" is a default for the next pictures, not a person command
  if (verb === "collect" && !amount) return null;
  return { verb, amount, date, query, board };
}

type Found = { rec: PersonRec; day: string; folder: string; all: PersonRec[] };

async function readBoard(target: InboxTarget, day: string): Promise<{ folder: string; all: PersonRec[] }> {
  const folder = boardFolder(target.ns, day, target.office);
  const m = await loadManifest(target.ns, day, target.office, folder);
  return { folder, all: m ? (await readRecords(folder, Object.keys(m.entries))).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [] };
}

function matches(p: PersonRec, query: string[]): boolean {
  const f = fieldsOf(p);
  const hay = `${f.lastName ?? ""} ${f.firstName ?? ""} ${f.chineseName ?? ""} ${f.passportNo ?? ""}`.toUpperCase();
  return query.every((q) => hay.includes(q.toUpperCase()));
}

// "1", "#1", "A1", "ลำดับ1" = queue position on the board (the number shown on the card / summary);
// "1-4" or "1,3,5" = several. Returns the positions, or null when the query is a name.
export function queuePositions(query: string[]): number[] | null {
  const out: number[] = [];
  for (const raw of query) {
    for (const tok of raw.split(",").filter(Boolean)) {
      const m = tok.match(/^(?:#|[aA]|ลำดับ|คิว|no\.?)?(\d{1,2})(?:-(\d{1,2}))?$/);
      if (!m) return null;
      const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.push(i);
    }
  }
  return out.length ? [...new Set(out)] : null;
}

/** Find the person on today's board, else on the filing-day board. */
export async function findPerson(target: InboxTarget, query: string[], ts: number, filingDay: string): Promise<{ hits: Found[]; byQueue: boolean }> {
  const days = [todayKey(ts)];
  if (filingDay !== days[0]) days.push(filingDay);
  const hits: Found[] = [];
  const positions = queuePositions(query);
  for (const day of days) {
    const { folder, all } = await readBoard(target, day);
    if (positions) {
      const live = all.filter((p) => !p.cancelled && !p.movedTo);
      for (const n of positions) { const rec = live[n - 1]; if (rec) hits.push({ rec, day, folder, all }); }
    } else {
      for (const rec of all.filter((p) => !p.movedTo && matches(p, query))) hits.push({ rec, day, folder, all });
    }
    if (hits.length) break;                             // found on the earlier board → don't look further
  }
  return { hits, byQueue: !!positions };
}

const statusLine = (p: PersonRec, all: PersonRec[]): string => {
  const f = fieldsOf(p);
  const live = all.filter((x) => !x.cancelled && !x.movedTo);
  const pos = live.findIndex((x) => x.id === p.id) + 1;
  const pay = f.pay === "nocollect" ? "🤝 ไม่เก็บ" : f.pay === "hold" ? "🔒 รอโอน (hold พาส)" : f.pay === "paid" ? "✅ จ่ายแล้ว" :
    f.pay === "collect" ? `💰 เก็บ ${money(f.amount)}${f.paidHow === "cash" ? ` · 💵 รับสดแล้ว ${money(f.paidAmount || f.amount)}` : f.paidHow === "transfer" ? ` · 🏦 โอนแล้ว ${money(f.paidAmount || f.amount)}` : f.paidHow === "waiting" ? " · 🕓 รอโอน" : f.paidHow === "agent" ? " · เก็บที่เอเย่นต์" : " · ยังไม่จ่าย"}` : "";
  return [
    `${p.cancelled ? "🚫 ยกเลิก" : p.arrived ? "✅ มาแล้ว" : "⏳ ยังไม่มา"} · ${nameOf(p)}${f.chineseName && f.chineseName !== nameOf(p) ? ` ${f.chineseName}` : ""}${pos ? ` · คิว ${pos}/${live.length}` : ""}`,
    [f.passportNo, f.agent && `🏢 ${f.agent}`, f.vip && "👑 VIP", f.run === "RUN30" && "🐰 +30", f.cambodia && "🐻", f.overstay && "🐢"].filter(Boolean).join(" · "),
    pay,
  ].filter(Boolean).join("\n");
};

async function copyBlob(from: string, to: string): Promise<boolean> {
  const r = await blobGetByPath(from, true);
  if (!r || !r.ok) return false;
  await blobPut(to, await r.arrayBuffer(), r.headers.get("content-type") || "application/octet-stream");
  return true;
}

/** What changed, so the caller can send the matching summary picture: the board, the day and the agents touched. */
export type CommandResult = { text: string; changed?: { target: InboxTarget; day: string; agents: string[] } };

/** Run one command. Returns the reply text (and what changed). */
export async function runPersonCommand(cmd: PersonCommand, groupTarget: InboxTarget, ts: number, filingDay: string): Promise<CommandResult> {
  const target = cmd.board ?? groupTarget;
  const { hits, byQueue } = await findPerson(target, cmd.query, ts, filingDay);
  const office = OFFICES[target.office];
  if (!hits.length) return { text: `ไม่พบ “${cmd.query.join(" ")}” บนบอร์ด ${office.label} ${keyToDate(todayKey(ts))}${filingDay !== todayKey(ts) ? ` / ${keyToDate(filingDay)}` : ""}` };
  if (cmd.verb === "status") return { text: hits.slice(0, 8).map((h) => `${statusLine(h.rec, h.all)}\n📅 ${office.label} ${keyToDate(h.day)}`).join("\n\n") };
  if (hits.length > 1 && !byQueue) return { text: `เจอ ${hits.length} คน พิมพ์ชื่อให้ชัดกว่านี้ หรือใช้เลขคิว:\n${hits.map((h) => `• ${h.all.filter((x) => !x.cancelled && !x.movedTo).indexOf(h.rec) + 1}. ${nameOf(h.rec)} · ${fieldsOf(h.rec).passportNo ?? ""}`).join("\n")}` };
  // several queue numbers at once (มาแล้ว 1 3 5) — one simple action each; money / move stay one person at a time
  if (hits.length > 1 && (cmd.verb === "move" || cmd.amount)) return { text: "สั่งเงินหรือย้ายได้ทีละคน — ใส่เลขคิวเดียว" };
  const outs: string[] = [];
  for (const h of hits) outs.push(await applyOne(cmd, h, target, office.label));
  const agents = [...new Set(hits.map((h) => String(fieldsOf(h.rec).agent ?? "").trim()))];
  return { text: outs.join("\n\n"), changed: { target, day: hits[0].day, agents } };
}

async function applyOne(cmd: PersonCommand, h: Found, target: InboxTarget, officeLabel: string): Promise<string> {
  const base = JSON.parse(JSON.stringify(h.rec)) as PersonRec;
  const rec = JSON.parse(JSON.stringify(h.rec)) as PersonRec;
  const f = (rec.fields ??= {}) as Record<string, unknown>;
  let did = "";
  switch (cmd.verb) {
    case "arrive": rec.arrived = true; rec.cancelled = false; did = "✅ ติ๊กมาแล้ว"; break;
    case "unarrive": rec.arrived = false; did = "⏳ เอาติ๊กมาแล้วออก"; break;
    case "cash": f.paidHow = "cash"; f.paidAmount = cmd.amount ?? String(f.amount ?? ""); if (cmd.amount && !f.amount) { f.amount = cmd.amount; f.pay = "collect"; } did = `💵 รับเงินสด ${money(f.paidAmount)}`; break;
    case "transfer": f.paidHow = "transfer"; f.paidAmount = cmd.amount ?? String(f.amount ?? ""); if (cmd.amount && !f.amount) { f.amount = cmd.amount; f.pay = "collect"; } did = `🏦 รับโอน ${money(f.paidAmount)}`; break;
    case "waiting": f.paidHow = "waiting"; f.paidAmount = ""; did = "🕓 รอโอน"; break;
    case "pending": f.paidHow = "pending"; f.paidAmount = ""; did = "↩️ กลับเป็นยังไม่จ่าย"; break;
    case "collect": f.amount = cmd.amount; f.pay = "collect"; did = `💰 ตั้งยอดเก็บ ${money(cmd.amount)}`; break;
    case "vip": f.vip = true; did = "👑 VIP"; break;
    case "novip": f.vip = false; did = "เอา VIP ออก"; break;
    case "cancel": rec.cancelled = true; rec.arrived = false; did = "🚫 ยกเลิก (ไม่มา)"; break;
    case "uncancel": rec.cancelled = false; did = "↩️ เอากลับขึ้นบอร์ด"; break;
    case "move": {
      const toKey = cmd.date!.replace(/\//g, "");
      if (toKey === h.day) return `${nameOf(rec)} อยู่วัน ${cmd.date} อยู่แล้ว`;
      const dest = await readBoard(target, toKey);
      const order = dest.all.reduce((m, x) => Math.max(m, x.order ?? 0), 0) + 1;
      // copy the files next to the person on the other day (the weekly purge clears whole days)
      const copy = JSON.parse(JSON.stringify(h.rec)) as PersonRec;
      const files = (copy.files as Record<string, unknown>[] | undefined) ?? [];
      for (const file of files) {
        const from = typeof file.path === "string" ? file.path : "";
        if (!from || !from.startsWith(h.folder)) continue;
        const to = `${dest.folder}${from.slice(h.folder.length)}`;
        if (await copyBlob(from, to)) file.path = to;
      }
      for (const k of ["tm7Pdf", "aiPhoto", "photo", "collectImage"] as const) {
        const from = copy[k];
        if (typeof from === "string" && from.startsWith(h.folder)) { const to = `${dest.folder}${from.slice(h.folder.length)}`; if (await copyBlob(from, to)) copy[k] = to; }
      }
      const moved = { ...copy, order, cancelled: false, movedTo: undefined, arrived: false };
      const res = await saveToBoard(target.ns, toKey, target.office, dest.folder, { v: 2, people: [moved], revive: true });
      if (res.rejected.includes(moved.id)) return `ย้ายไม่สำเร็จ — ปลายทางไม่รับรายการนี้ ลองใหม่อีกครั้ง`;
      rec.movedTo = cmd.date; rec.arrived = false;
      did = `📅 ย้ายไปวัน ${cmd.date}`;
      break;
    }
  }
  await saveToBoard(target.ns, h.day, target.office, h.folder, { v: 2, people: [rec], bases: { [rec.id]: base } });
  const after = h.all.map((x) => (x.id === rec.id ? rec : x));
  return `${did} · ${nameOf(rec)}\n${statusLine(rec, after)}\n📅 ${officeLabel} ${keyToDate(h.day)}`;
}

/** Passport picture of someone already on today's board → check-in. Returns the reply, or null when nobody matched. */
export async function checkInByPassport(target: InboxTarget, passportNo: string, ts: number): Promise<string | null> {
  if (!passportNo) return null;
  const day = todayKey(ts);
  const { folder, all } = await readBoard(target, day);
  const p = all.find((x) => !x.movedTo && !x.cancelled && (fieldsOf(x).passportNo ?? "").toUpperCase() === passportNo.toUpperCase());
  if (!p) return null;
  if (p.arrived) return `ℹ️ ${nameOf(p)} ติ๊กมาแล้วอยู่ก่อนแล้ว\n${statusLine(p, all)}`;
  const base = JSON.parse(JSON.stringify(p)) as PersonRec;
  const rec = { ...JSON.parse(JSON.stringify(p)), arrived: true } as PersonRec;
  await saveToBoard(target.ns, day, target.office, folder, { v: 2, people: [rec], bases: { [rec.id]: base } });
  const after = all.map((x) => (x.id === rec.id ? rec : x));
  return `✅ เช็คอินแล้ว\n${statusLine(rec, after)}`;
}

export const PERSON_HELP = [
  "🧑‍💼 สั่งงานบนการ์ด (คำสั่ง + ชื่อ หรือ เลขคิวบนบอร์ด):",
  "• มา 1 · มา 1 3 5 · มา 1-4 · ไม่มา 2 · ยก 2 (ยกเลิก) · คืน 2",
  "• สด 4500 1 · โอน 4500 1 · รอ 1 (รอโอน) · ยังไม่จ่าย 1 · เก็บ 4500 1",
  "• vip 1 · ไม่vip 1 · ย 17/11 1 (ย้ายวัน)",
  "• ?1 หรือ ?LI → ดูการ์ด · สรุป → ทั้งบอร์ดพร้อมเลขคิว",
  "• ใช้ชื่อแทนเลขได้: มาแล้ว LI KAI · จ่ายสด 4500 LI",
  "• สั่งข้ามหน้างาน: it1 · non2 · r1 · vfs1 · vfsp1 · cs1 (รัน) เช่น มา it1 it3 · สด 4700 non2 · สรุป it",
  "• ส่งรูปพาสของคนที่อยู่บนบอร์ดวันนี้ซ้ำ = เช็คอิน ✅",
  "• หลังสั่ง บอทส่งรูป Summary ของเอเย่นต์คนนั้นกลับมาให้ (forward ต่อได้เลย) · ปิด/เปิดด้วย รูปอัตโนมัติ ปิด / เปิด",
  "• ขอรูปเอง: รูป · รูป it · รูป it อาเต่า · รูป อาเต่า",
];
