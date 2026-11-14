// =============================================================
// LINE inbox → day boards (server only)
// =============================================================
// A LINE group tagged with a target (e.g. "📥 IT" → extension board, Bangkok;
// "📥 วีซ่ารัน" → run board, Chiang Saen) is an intake tray: the user forwards
// a customer's pictures (passport, entry stamp, selfie — any order) from the
// agent's chat into the group, and the bot files a person onto that board:
//
//   • which day: before 17:00 Bangkok → today (if the office is open that day,
//     else the next working day); from 17:00 → the next working day. The run
//     board goes out every day, so "next day" is simply tomorrow. A date typed
//     in the group ("15/11", "วันนี้", "พรุ่งนี้") overrides until midnight.
//   • who they belong to / what they pay: a short text before the pictures sets
//     defaults for everything that follows — "อาเต่า 4000", "VIP", "+30",
//     "ไม่เก็บ" — until changed; "ล้างค่า" resets them.
//   • grouping: pictures forwarded within a few seconds of each other are one
//     burst, filed in order — a passport starts a person, what follows belongs
//     to them (pictures before the first passport belong to it too). A picture
//     that arrives alone attaches to the last person this group created in the
//     past 15 minutes, else waits for the next passport.
//
// Storage: inbox/<groupId>/state.json   defaults + last person
//          inbox/<groupId>/burst/<messageId>.json + the picture bytes (until filed)
//          inbox/<groupId>/waiting/<messageId>.<ext>   lone pictures awaiting a passport
// People are written with the same merge as the app (saveToBoard), ids are
// derived from the LINE message ids so a retried webhook never duplicates.
import { blobDelete, blobGetByPath, blobGetJson, blobList, blobPut } from "@/lib/blob";
import { analyzeDoc, type AnalyzedDoc } from "@/app/actions/analyzeDoc";
import { boardFolder, loadManifest, readRecords, saveToBoard, type PersonRec } from "@/lib/day-server";
import { OFFICES, type OfficeId } from "@/lib/offices";
import { DIRECT_CUSTOMER, MAIN_AGENTS } from "@/lib/today/agents";
import { DEFAULT_HOLIDAYS, EMPTY_FIELDS, isWorkingDay, type PersonFields } from "@/lib/today/types";

export type InboxTarget = { ns: "days" | "run"; office: OfficeId };

type Defaults = { agent?: string; amount?: string; vip?: boolean; run?: "RUN" | "RUN30"; pay?: PersonFields["pay"]; dateKey?: string; dateSetDay?: string; setAt?: number };
type GroupState = { defaults: Defaults; lastPersonId?: string; lastPersonAt?: number; lastBoard?: string; waiting: WaitingItem[] };
type WaitingItem = { id: string; kind: AnalyzedDoc["docType"]; path: string; mime: string; ts: number; data?: AnalyzedDoc };
type SetItem = { id: string; setId: string; index: number; total: number; ts: number; path: string; mime: string; kind: AnalyzedDoc["docType"]; data?: AnalyzedDoc; error?: string };

const BKK = 7 * 3600 * 1000;
const statePath = (g: string) => `inbox/${g}/state.json`;

export async function loadState(groupId: string): Promise<GroupState> {
  return (await blobGetJson<GroupState>(statePath(groupId))) ?? { defaults: {}, waiting: [] };
}
async function saveState(groupId: string, s: GroupState): Promise<void> {
  await blobPut(statePath(groupId), JSON.stringify(s), "application/json");
}

// ---------- which day ----------
const pad = (n: number) => String(n).padStart(2, "0");
export const ddmmyyyy = (d: Date) => `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;   // d is a "Bangkok wall clock" date held in UTC fields
const keyOf = (ddmm: string) => ddmm.replace(/\//g, "");
function bkkNow(ts: number): Date { return new Date(ts + BKK); }
function bkkDayKey(ts: number): string { return keyOf(ddmmyyyy(bkkNow(ts))); }
function openOn(d: Date, target: InboxTarget): boolean {
  if (target.ns === "run") return true;
  // isWorkingDay works on local Date fields; build one from the wall-clock parts
  return isWorkingDay(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), DEFAULT_HOLIDAYS);
}
export function targetDate(ts: number, target: InboxTarget, defaults: Defaults): string {
  if (defaults.dateKey && defaults.dateSetDay === bkkDayKey(ts)) return defaults.dateKey;   // typed today → still valid
  const now = bkkNow(ts);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (now.getUTCHours() >= 17) d.setUTCDate(d.getUTCDate() + 1);
  while (!openOn(d, target)) d.setUTCDate(d.getUTCDate() + 1);
  return ddmmyyyy(d);
}

// ---------- text commands ----------
export function parseCommand(text: string, ts: number, defaults: Defaults): { defaults: Defaults; summary?: "today" | string; reply?: string } | null {
  const t = text.trim();
  if (!t) return null;
  if (/^(สรุป|summary)$/i.test(t)) return { defaults, summary: "today" };
  const m = t.match(/^(สรุป|summary)\s+(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/i);
  if (m) return { defaults, summary: toDate(m[2], m[3], m[4], ts) };
  if (/^(ล้างค่า|reset|clear)$/i.test(t)) return { defaults: {}, reply: "ล้างค่าตั้งต้นแล้ว — รูปถัดไปจะไม่มีเอเจนซี่/ยอด/VIP จนกว่าจะพิมพ์ใหม่" };
  if (/^(ช่วย|help|\?)$/i.test(t)) return { defaults, reply: HELP };

  const next: Defaults = { ...defaults };
  const used: string[] = [];
  let touched = false;
  for (const tok of t.split(/\s+/)) {
    const low = tok.toLowerCase();
    let dm: RegExpMatchArray | null;
    if (/^vip$/i.test(tok)) { next.vip = true; used.push("👑 VIP"); touched = true; continue; }
    if (/^(ไม่vip|novip|-vip)$/i.test(tok)) { next.vip = false; used.push("ไม่ VIP"); touched = true; continue; }
    if (/^(\+30|รัน30|run30|ต่อ30)$/i.test(tok)) { next.run = "RUN30"; used.push("🐰 ไปต่อ 30 วัน"); touched = true; continue; }
    if (/^(รัน|run|รันปกติ)$/i.test(tok)) { next.run = "RUN"; used.push("รันปกติ"); touched = true; continue; }
    if (/^(ไม่เก็บ|nocollect)$/i.test(tok)) { next.pay = "nocollect"; next.amount = ""; used.push("🤝 ไม่เก็บ"); touched = true; continue; }
    if (/^(จ่ายแล้ว|paid)$/i.test(tok)) { next.pay = "paid"; used.push("✅ จ่ายแล้ว"); touched = true; continue; }
    if (/^(รอโอน|hold)$/i.test(tok)) { next.pay = "hold"; used.push("🔒 รอโอน hold พาส"); touched = true; continue; }
    if (/^(เก็บ|collect)$/i.test(tok)) { next.pay = "collect"; used.push("💰 เก็บเงิน"); touched = true; continue; }
    if (/^\d{3,6}$/.test(tok) && Number(tok) >= 100) { next.amount = String(Number(tok)); next.pay = "collect"; used.push(`💰 เก็บ ${Number(tok).toLocaleString()}`); touched = true; continue; }
    if (/^(วันนี้|today)$/i.test(low)) { next.dateKey = ddmmyyyy(bkkNow(ts)); next.dateSetDay = bkkDayKey(ts); used.push(`📅 ลง ${next.dateKey}`); touched = true; continue; }
    if (/^(พรุ่งนี้|tomorrow)$/i.test(low)) { const d = bkkNow(ts); d.setUTCDate(d.getUTCDate() + 1); next.dateKey = ddmmyyyy(d); next.dateSetDay = bkkDayKey(ts); used.push(`📅 ลง ${next.dateKey}`); touched = true; continue; }
    if ((dm = tok.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/))) { next.dateKey = toDate(dm[1], dm[2], dm[3], ts); next.dateSetDay = bkkDayKey(ts); used.push(`📅 ลง ${next.dateKey}`); touched = true; continue; }
    // anything else is an agent name: the main list first (case-insensitive), otherwise taken as typed
    const known = [...MAIN_AGENTS, DIRECT_CUSTOMER].find((a) => a.toLowerCase() === low);
    next.agent = known ?? tok;
    used.push(`🏢 ${next.agent}`);
    touched = true;
  }
  if (!touched) return null;
  next.setAt = ts;
  return { defaults: next, reply: `ตั้งค่าสำหรับรูปถัดไป: ${used.join(" · ")}` };
}
function toDate(dd: string, mm: string, yy: string | undefined, ts: number): string {
  const y = yy ? (yy.length === 2 ? 2000 + Number(yy) : Number(yy) > 2400 ? Number(yy) - 543 : Number(yy)) : bkkNow(ts).getUTCFullYear();
  return `${pad(Number(dd))}/${pad(Number(mm))}/${y}`;
}
const HELP = [
  "📥 วิธีใช้กล่องรับงาน",
  "• forward รูปลูกค้า (พาส/ตรา/เซลฟี่) เข้ามา → ขึ้นบอร์ดเอง",
  "• พิมพ์ก่อน forward เพื่อตั้งค่า: อาเต่า 4000 · VIP · +30 · ไม่เก็บ · รอโอน · 15/11 · พรุ่งนี้",
  "• สรุป → รายชื่อที่ลงบอร์ดวันนั้น · ล้างค่า → ยกเลิกค่าตั้งต้น",
  "• ก่อน 17:00 ลงวันนี้ · หลัง 17:00 ลงวันทำการถัดไป",
].join("\n");

// ---------- pictures ----------
function sniff(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  return "image/jpeg";
}
const extOf = (mime: string) => (mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg");

async function ocr(bytes: ArrayBuffer, mime: string): Promise<AnalyzedDoc | undefined> {
  const fd = new FormData();
  fd.set("image", new File([bytes], `line.${extOf(mime)}`, { type: mime }));
  const r = await analyzeDoc(fd);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

export type IntakeResult = { reply?: string };

// Forwarded pictures arrive as separate webhook calls within a second or two
// of each other (a forward of several messages is NOT one LINE image set).
// So every picture is read, parked in the group's "burst" folder, and after a
// short quiet period the handler that finds no newer picture files the whole
// burst in message order: passport = a person, what follows belongs to them.
const QUIET_MS = 4500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const burstDir = (g: string) => `inbox/${g}/burst/`;

/** One picture from a tagged group. Returns what to say back (nothing while the burst is still arriving). */
export async function intakeImage(groupId: string, target: InboxTarget, msg: { id: string; setId?: string; index?: number; total?: number }, ts: number, bytes: ArrayBuffer): Promise<IntakeResult> {
  const mime = sniff(new Uint8Array(bytes.slice(0, 16)));
  const path = `${burstDir(groupId)}${msg.id}.${extOf(mime)}`;
  await blobPut(path, bytes, mime);

  const item: SetItem = { id: msg.id, setId: msg.setId ?? msg.id, index: msg.index ?? 1, total: msg.total ?? 1, ts, path, mime, kind: "other" };
  try {
    const d = await ocr(bytes, mime);
    if (d) { item.data = d; item.kind = d.docType; }
  } catch (e) {
    item.error = e instanceof Error ? e.message : String(e);
  }
  await blobPut(`${burstDir(groupId)}${msg.id}.json`, JSON.stringify(item), "application/json");

  await sleep(QUIET_MS);
  const listed = (await blobList(burstDir(groupId))).filter((b) => b.pathname.endsWith(".json"));
  const items = (await Promise.all(listed.map((b) => blobGetJson<SetItem>(b.pathname)))).filter((x): x is SetItem => !!x).sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  if (!items.some((i) => i.id === msg.id)) return {};          // another handler already filed this burst (and cleaned up)
  const newest = items[items.length - 1];
  if (newest.id !== msg.id && Date.now() - newest.ts < QUIET_MS) return {};   // a newer picture is still being read — it will file the burst
  return fileSet(groupId, target, items, ts);
}

// Turn a set of read pictures into people on the board.
async function fileSet(groupId: string, target: InboxTarget, items: SetItem[], ts: number): Promise<IntakeResult> {
  const state = await loadState(groupId);
  const date = targetDate(ts, target, state.defaults);
  const day = keyOf(date);
  const folder = boardFolder(target.ns, day, target.office);
  const boardKey = `${target.ns}/${day}/${target.office}`;
  const manifest = await loadManifest(target.ns, day, target.office, folder);
  const existing = manifest ? await readRecords(folder, Object.keys(manifest.entries)) : [];
  let nextOrder = existing.reduce((m, p) => Math.max(m, p.order ?? 0), 0) + 1;

  type Draft = { rec: PersonRec; files: SetItem[]; isNew: boolean };
  const drafts: Draft[] = [];
  const replies: string[] = [];
  let current: Draft | null = null;

  // a picture that arrived alone and found nobody to attach to (last 30 min)
  const waiting = state.waiting.filter((w) => ts - w.ts < 30 * 60 * 1000);

  const draftFor = (id: string, isNew: boolean, base?: PersonRec): Draft => {
    const fields: PersonFields = { ...EMPTY_FIELDS, ...((base?.fields as Partial<PersonFields>) ?? {}) };
    if (isNew) applyDefaults(fields, state.defaults, target);
    const rec: PersonRec = base ? { ...base, fields: { ...fields } } : { id, order: nextOrder++, fields: { ...fields }, files: [], createdAt: ts, source: "line", lineGroup: groupId };
    return { rec, files: [], isNew };
  };

  // pictures that came BEFORE the first passport of this burst belong to that passport
  const firstPp = items.findIndex((i) => i.kind === "passport" && i.data);
  const lead = firstPp > 0 ? items.slice(0, firstPp) : [];
  const ordered = firstPp > 0 ? [...items.slice(firstPp), ...lead] : items;
  for (const it of ordered) {
    if (it.kind === "passport" && it.data) {
      const no = it.data.passportNo;
      const same = no ? existing.find((p) => (p.fields as PersonFields | undefined)?.passportNo === no) : undefined;
      const d = same ? draftFor(same.id, false, same) : draftFor(`li-${it.id}`, true);
      d.rec.fields = applyPassport(d.rec.fields as PersonFields, it.data) as unknown as Record<string, unknown>;
      d.files.push(it);
      // pictures that were waiting for a passport belong to this person
      for (const w of waiting.splice(0)) d.files.push({ id: w.id, setId: "waiting", index: 0, total: 1, ts: w.ts, path: w.path, mime: w.mime, kind: w.kind, data: w.data });
      drafts.push(d);
      current = d;
      continue;
    }
    // not a passport: the person being built in this set, else the group's last person (15 min), else wait
    let d: Draft | null = current;
    if (!d && state.lastPersonId && state.lastBoard === boardKey && ts - (state.lastPersonAt ?? 0) < 15 * 60 * 1000) {
      const last = existing.find((p) => p.id === state.lastPersonId);
      if (last) { d = draftFor(last.id, false, last); drafts.push(d); current = d; }
    }
    if (!d) {
      const keep = `inbox/${groupId}/waiting/${it.id}.${extOf(it.mime)}`;
      const src = await fetchBlob(it.path);
      if (src) await blobPut(keep, src, it.mime);
      waiting.push({ id: it.id, kind: it.kind, path: keep, mime: it.mime, ts: it.ts, data: it.data });
      replies.push(`🕐 ${kindTh(it.kind)} รอพาสปอร์ตของคนนี้ (ส่งพาสตามมาได้เลย)`);
      continue;
    }
    d.files.push(it);
  }

  // stamps fill in arrival / admitted-until on whoever they are attached to
  for (const d of drafts) {
    for (const it of d.files) if (it.kind === "stamp" && it.data) d.rec.fields = applyStamp(d.rec.fields as PersonFields, it.data) as unknown as Record<string, unknown>;
  }

  // move the pictures next to the person and write the records
  const out: PersonRec[] = [];
  for (const d of drafts) {
    const files = ((d.rec.files as Record<string, unknown>[] | undefined) ?? []).slice();
    for (const it of d.files) {
      if (files.some((f) => f.id === it.id)) continue;
      const dest = `${folder}${d.rec.id}/doc-${it.id}.${extOf(it.mime)}`;
      const src = await fetchBlob(it.path);
      if (src) await blobPut(dest, src, it.mime);
      files.push({ id: it.id, kind: it.kind, name: `line-${it.id}.${extOf(it.mime)}`, mime: it.mime, status: it.error ? "error" : "done", error: it.error, photoBox: it.data?.photoBox || undefined, path: dest });
    }
    d.rec.files = files;
    out.push(d.rec);
  }
  if (out.length) await saveToBoard(target.ns, day, target.office, folder, { v: 2, people: out, revive: true });

  // remember who came last for lone pictures that follow
  const lastNew = drafts.filter((d) => d.files.some((f) => f.kind === "passport")).slice(-1)[0] ?? drafts.slice(-1)[0];
  const nextState: GroupState = { ...state, waiting, lastPersonId: lastNew?.rec.id ?? state.lastPersonId, lastPersonAt: lastNew ? ts : state.lastPersonAt, lastBoard: lastNew ? boardKey : state.lastBoard };
  await saveState(groupId, nextState);
  // the burst's temporary copies are no longer needed (pictures now live next to their person)
  const tmp = await blobList(burstDir(groupId));
  const mine = new Set(items.map((i) => i.id));
  const victims = tmp.filter((b) => mine.has(b.pathname.split("/").pop()!.replace(/\.[a-z]+$/, "")));
  if (victims.length) await blobDelete(victims.map((x) => x.url)).catch(() => undefined);

  const office = OFFICES[target.office];
  for (const d of drafts) {
    const f = d.rec.fields as PersonFields;
    const name = [f.lastName, f.firstName].filter(Boolean).join(" ");
    const kinds = d.files.map((x) => kindTh(x.kind)).join("+");
    const pos = existing.length + drafts.filter((x) => x.isNew).indexOf(d) + 1;
    if (d.isNew) {
      const bits = [f.agent && `🏢 ${f.agent}`, f.pay === "collect" && f.amount && `💰 เก็บ ${Number(f.amount).toLocaleString()}`, f.pay === "nocollect" && "🤝 ไม่เก็บ", f.pay === "hold" && "🔒 รอโอน", f.vip && "👑 VIP", target.ns === "run" && f.run === "RUN30" && "🐰 +30"].filter(Boolean).join(" · ");
      replies.push(`✅ ${name || "(อ่านชื่อไม่ออก)"}${f.chineseName ? ` ${f.chineseName}` : ""}${f.passportNo ? ` · ${f.passportNo}` : ""}\n→ ${office.label} ${date} (คนที่ ${pos}) · ${kinds}${bits ? `\n${bits}` : ""}${!f.arrivalDate ? "\n⚠️ ยังไม่มีตราเข้าเมือง" : ""}`);
    } else {
      replies.push(`📎 ${kinds} → ${name || d.rec.id}${f.chineseName ? ` ${f.chineseName}` : ""} (${office.label} ${date})`);
    }
  }
  if (items.some((i) => i.error)) replies.push(`⚠️ มี ${items.filter((i) => i.error).length} รูปอ่านไม่สำเร็จ — เก็บรูปไว้ในการ์ดแล้ว แก้ข้อมูลเองบนบอร์ด`);
  return { reply: replies.join("\n\n") };
}

async function fetchBlob(path: string): Promise<ArrayBuffer | null> {
  const r = await blobGetByPath(path, true);
  return r && r.ok ? r.arrayBuffer() : null;
}

function applyDefaults(f: PersonFields, d: Defaults, target: InboxTarget): void {
  if (d.agent) f.agent = d.agent;
  if (d.amount) { f.amount = d.amount; f.pay = "collect"; }
  if (d.pay) f.pay = d.pay;
  if (d.vip !== undefined) f.vip = d.vip;
  if (target.ns === "run") f.run = d.run ?? "RUN";
  if (target.ns === "days") f.report = true;
}
function applyPassport(f: PersonFields, d: AnalyzedDoc): PersonFields {
  return {
    ...f,
    title: (d.title || f.title) as PersonFields["title"],
    firstName: d.firstName || f.firstName, lastName: d.lastName || f.lastName, chineseName: d.chineseName || f.chineseName,
    nationality: d.nationality || f.nationality, dateOfBirth: d.dateOfBirth || f.dateOfBirth, placeOfBirth: d.placeOfBirth || f.placeOfBirth,
    passportNo: d.passportNo || f.passportNo, passportIssueDate: d.passportIssueDate || f.passportIssueDate, passportExpiryDate: d.passportExpiryDate || f.passportExpiryDate, passportIssuedAt: d.passportIssuedAt || f.passportIssuedAt,
  };
}
function applyStamp(f: PersonFields, d: AnalyzedDoc): PersonFields {
  return { ...f, arrivalDate: d.arrivalDate || f.arrivalDate, admittedUntil: d.admittedUntil || f.admittedUntil, portOfArrival: d.portOfArrival || f.portOfArrival, arrivedBy: d.arrivedBy || f.arrivedBy };
}
const KIND_TH: Record<string, string> = { passport: "พาสปอร์ต", stamp: "ตราเข้าเมือง", selfie: "เซลฟี่", tm30: "TM30", other: "รูปอื่น" };
const kindTh = (k: string) => KIND_TH[k] ?? k;

// ---------- "สรุป" ----------
export async function boardSummary(target: InboxTarget, date: string): Promise<string> {
  const day = keyOf(date);
  const folder = boardFolder(target.ns, day, target.office);
  const m = await loadManifest(target.ns, day, target.office, folder);
  const people = m ? (await readRecords(folder, Object.keys(m.entries))).filter((p) => !p.cancelled && !p.movedTo).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];
  const office = OFFICES[target.office];
  if (!people.length) return `${office.emoji} ${office.label} ${date}: ยังไม่มีใครบนบอร์ด`;
  const lines = people.map((p, i) => {
    const f = p.fields as PersonFields;
    const bits = [f.agent, f.pay === "collect" && f.amount ? `เก็บ ${Number(f.amount).toLocaleString()}` : f.pay === "hold" ? "รอโอน" : f.pay === "nocollect" ? "ไม่เก็บ" : "", f.vip ? "👑" : "", f.run === "RUN30" ? "🐰" : ""].filter(Boolean).join(" · ");
    return `${i + 1}. ${[f.lastName, f.firstName].filter(Boolean).join(" ") || "(ไม่มีชื่อ)"}${f.chineseName ? ` ${f.chineseName}` : ""}${f.passportNo ? ` · ${f.passportNo}` : ""}${bits ? `\n   ${bits}` : ""}`;
  });
  return `${office.emoji} ${office.label} ${date} — ${people.length} คน\n${lines.join("\n")}`;
}
