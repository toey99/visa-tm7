// =============================================================
// 90-day report board — shared types + pure helpers (client & server)
// =============================================================
// Every image forwarded into the LINE "กล่องรับงาน" group becomes one item.
// Nothing is typed by hand: passport bio pages open a case, receipt slips
// close it. Which slip belongs to which passport is worked out when the
// board is read (buildCases), so the webhook never has to edit shared state.
//
// Keep this file free of "@/…" imports — the unit test runs it with plain node.

export type D90Kind = "passport" | "slip" | "other";

export type D90Item = {
  id: string;          // LINE message id
  ts: number;          // ms since epoch (LINE event time)
  kind: D90Kind;
  img: string;         // blob pathname of the picture
  groupId: string;
  setId?: string;      // LINE image-set id (pictures sent together)
  name: string;        // SURNAME GIVEN — as read, editable on the board
  cn?: string;         // 中文姓名 — printed on Chinese passports; slips never carry it
  passportNo: string;
  nationality: string;
  nextDue: string;     // DD/MM/YYYY — slips only: next report date
  linkTo?: string;     // slips only: passport item id chosen by hand
  old?: boolean;       // slips only: set by hand — true = previous slip sent in with the job, false = the new result
  done?: boolean;      // passports only: closed by hand without a slip
  note?: string;
};

// target: where this group's pictures go — unset = the 90-day board; otherwise a day board (extension / visa run) for one office
export type D90Group = { name: string; status: "pending" | "allowed"; ts: number; target?: { ns: "days" | "run"; office: string } };

export type D90Case = {
  passport: D90Item;
  pages: D90Item[];    // other pages sent with it (entry stamp, visa, the PREVIOUS 90-day slip…)
  slip: D90Item | null;
  how: "" | "passport" | "name" | "fuzzy" | "manual";
};

export type D90Board = { cases: D90Case[]; orphanSlips: D90Item[]; loose: D90Item[] };

const NOISE = new Set(["MR", "MRS", "MISS", "MS", "MALE", "FEMALE", "M", "F"]);

export function nameTokens(name: string): string[] {
  return name.toUpperCase().replace(/[^A-Z]+/g, " ").split(" ").filter((t) => t && !NOISE.has(t));
}
/** order-insensitive: "ZHONG LI" === "LI ZHONG" */
export function nameKey(name: string): string {
  return nameTokens(name).sort().join(" ");
}
/** spacing-insensitive too: "YANG LI FENG" === "LIFENG YANG" */
export function letterKey(name: string): string {
  return nameTokens(name).join("").split("").sort().join("");
}
export const ppKey = (pp: string) => pp.toUpperCase().replace(/[^A-Z0-9]/g, "");

function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (a.length < b.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

const PAGE_WINDOW_MS = 3 * 60 * 1000;
const ID_WINDOW_MS = 30 * 60 * 1000;
const NEW_SLIP_MIN_DAYS = 45;

function dueMs(ddmmyyyy: string): number {
  const m = ddmmyyyy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : NaN;
}

/**
 * Customers often send their PREVIOUS 90-day slip together with the passport.
 * That one must never close the job. A fresh slip's next date is ~90 days
 * ahead; a previous slip's date is the one falling due now. When the date
 * can't be read, a slip that arrives in the same batch as a passport (before
 * or after it) is taken to be the previous one.
 */
export function isOldSlip(s: D90Item, items: D90Item[]): boolean {
  if (typeof s.old === "boolean") return s.old;
  if (s.linkTo && s.linkTo !== "-") return false; // linked to a job by hand → it is that job's result
  const due = dueMs(s.nextDue);
  if (!Number.isNaN(due)) return due - s.ts < NEW_SLIP_MIN_DAYS * 86400000;
  return items.some((p) => p.kind === "passport" && p.groupId === s.groupId
    && ((!!s.setId && p.setId === s.setId) || Math.abs(s.ts - p.ts) <= PAGE_WINDOW_MS));
}

export function buildCases(items: D90Item[]): D90Board {
  const sorted = [...items].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  const cases: D90Case[] = sorted.filter((i) => i.kind === "passport").map((p) => ({ passport: p, pages: [], slip: null, how: "" }));
  const byId = new Map(cases.map((c) => [c.passport.id, c]));

  // ---- extra pages (entry stamp, visa, e-visa, previous slip) ----------------
  // Customers send them in any order, so position alone is not trusted:
  //   1. a hand link                       2. the passport no. / name printed on the page (visa, e-visa, slip)
  //   3. the only passport in the same LINE image set, or in the same burst of pictures
  //   4. several passports in one burst: follow the burst's own pattern — if it
  //      starts with a passport, pages follow their passport; otherwise each
  //      page goes to the passport nearest to it in the sequence
  const loose: D90Item[] = [];
  const oldSlips = new Set(sorted.filter((i) => i.kind === "slip" && isOldSlip(i, sorted)));
  const isPage = (i: D90Item) => i.kind === "other" || oldSlips.has(i);
  const bursts: D90Item[][] = [];
  const lastOfGroup = new Map<string, D90Item[]>();
  for (const it of sorted) {
    if (it.kind !== "passport" && !isPage(it)) continue;
    const cur = lastOfGroup.get(it.groupId);
    if (cur && it.ts - cur[cur.length - 1].ts <= PAGE_WINDOW_MS) cur.push(it);
    else { const nb = [it]; bursts.push(nb); lastOfGroup.set(it.groupId, nb); }
  }
  for (const burst of bursts) {
    const passIdx = burst.map((it, k) => (it.kind === "passport" ? k : -1)).filter((k) => k >= 0);
    burst.forEach((o, k) => {
      if (!isPage(o)) return;
      if (o.linkTo === "-") { loose.push(o); return; }
      let home = o.linkTo ? byId.get(o.linkTo) : undefined;
      if (!home && (ppKey(o.passportNo) || nameKey(o.name))) {
        const near = cases
          .filter((c) => c.passport.groupId === o.groupId && Math.abs(c.passport.ts - o.ts) <= ID_WINDOW_MS)
          .sort((x, y) => Math.abs(x.passport.ts - o.ts) - Math.abs(y.passport.ts - o.ts));
        const pp = ppKey(o.passportNo), nk = nameKey(o.name), lk = letterKey(o.name);
        home = (pp ? near.find((c) => ppKey(c.passport.passportNo) === pp) : undefined)
          ?? (nk ? near.find((c) => nameKey(c.passport.name) === nk || letterKey(c.passport.name) === lk) : undefined);
      }
      if (!home && o.setId) {
        const same = burst.filter((it) => it.kind === "passport" && it.setId === o.setId);
        if (same.length === 1) home = byId.get(same[0].id);
      }
      if (!home && passIdx.length === 1) home = byId.get(burst[passIdx[0]].id);
      if (!home && passIdx.length > 1) {
        const before = passIdx.filter((i) => i < k).pop();
        const after = passIdx.find((i) => i > k);
        let pick = before ?? after;
        if (burst[0].kind !== "passport" && before !== undefined && after !== undefined && after - k < k - before) pick = after;
        if (pick !== undefined) home = byId.get(burst[pick].id);
      }
      if (!home && o.kind === "slip" && nameKey(o.name)) {
        // a previous slip sent on its own: the latest job under the same name
        home = [...cases].reverse().find((c) => nameKey(c.passport.name) === nameKey(o.name) || letterKey(c.passport.name) === letterKey(o.name));
      }
      if (home) home.pages.push(o); else loose.push(o);
    });
  }

  // slips → manual link, passport number, exact name, spacing-insensitive name, one-letter slip
  const orphanSlips: D90Item[] = [];
  const slips = sorted.filter((i) => i.kind === "slip" && !oldSlips.has(i));
  for (const s of slips) {
    if (!s.linkTo) continue;
    const c = byId.get(s.linkTo);
    if (c && !c.slip) { c.slip = s; c.how = "manual"; }
  }
  for (const s of slips) {
    if (cases.some((c) => c.slip === s)) continue;
    if (s.linkTo === "-") { orphanSlips.push(s); continue; } // unlinked by hand: stay unmatched
    const open = cases.filter((c) => !c.slip && c.passport.ts <= s.ts);
    const sPp = ppKey(s.passportNo), sName = nameKey(s.name), sLetters = letterKey(s.name);
    let hit: D90Case | undefined;
    let how: D90Case["how"] = "";
    if (sPp) { hit = open.find((c) => ppKey(c.passport.passportNo) === sPp); how = "passport"; }
    if (!hit && sName) { hit = open.find((c) => nameKey(c.passport.name) === sName); how = "name"; }
    if (!hit && sLetters) { hit = open.find((c) => letterKey(c.passport.name) === sLetters); how = "name"; }
    if (!hit && sLetters.length >= 6) {
      const near = open.filter((c) => editDistanceAtMost1(letterKey(c.passport.name), sLetters));
      if (near.length === 1) { hit = near[0]; how = "fuzzy"; }
    }
    if (hit) { hit.slip = s; hit.how = how; } else orphanSlips.push(s);
  }
  return { cases, orphanSlips, loose };
}

/** "LI ZHONG 李忠" — the slip itself has no Chinese name, so a case borrows the passport's */
export const fullName = (it: { name: string; cn?: string }) => [it.name, it.cn].filter(Boolean).join(" ");
const hasCjk = (s: string) => /[\u3400-\u9fff]/.test(s);
const cjkOnly = (s: string) => s.replace(/[^\u3400-\u9fff]/g, "");

/** DD/MM/YYYY → 2027年02月01日 */
export function dueZh(ddmmyyyy: string): string {
  const m = ddmmyyyy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}年${m[2]}月${m[1]}日` : "";
}
/** ready-to-forward reminder for the customer / agent */
export function customerMsgZh(name: string, cn: string | undefined, nextDue: string): string {
  const who = [name, cn].filter(Boolean).join(" ");
  const due = dueZh(nextDue);
  return [who, "提醒您下一次的泰国90天报到 (90-day report)", due ? `日期是：${due}。` : "日期：请见回执单。"].filter(Boolean).join("\n");
}
/** the open case a just-arrived slip belongs to (same rules as buildCases), if any */
export function caseForSlip(items: D90Item[], slipId: string): D90Case | undefined {
  return buildCases(items).cases.find((c) => c.slip?.id === slipId);
}

export const isOpen = (c: D90Case) => !c.slip && !c.passport.done;

// ---- dates (always Bangkok) ------------------------------------------------
const BKK = 7 * 3600 * 1000;
/** YYYY-MM-DD of a timestamp in Bangkok */
export function bkkDay(ts: number): string {
  return new Date(ts + BKK).toISOString().slice(0, 10);
}
export function bkkTime(ts: number): string {
  return new Date(ts + BKK).toISOString().slice(11, 16);
}
export function dayLabelTh(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const months = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  return `${d} ${months[m - 1]} ${y}`;
}
export function dayLabelZh(day: string): string {
  const [, m, d] = day.split("-").map(Number);
  return `${m}月${d}日`;
}
export function daysWaiting(ts: number, now: number): number {
  return Math.round((Date.parse(bkkDay(now)) - Date.parse(bkkDay(ts))) / 86400000);
}

/** the "still waiting" list, in the shape the agent already uses in chat */
export function pendingListZh(board: D90Board): string {
  const open = board.cases.filter(isOpen);
  const days = new Map<string, string[]>();
  for (const c of open) {
    const k = bkkDay(c.passport.ts);
    days.set(k, [...(days.get(k) ?? []), fullName(c.passport) || "(未识别)"]);
  }
  const blocks = [...days.entries()].sort().map(([day, names]) => `${dayLabelZh(day)}提交\n${names.join("\n")}`);
  return [`90天报道 · 待出单 ${open.length} 人`, ...blocks].join("\n\n");
}

/** numbered list of every job received on one Bangkok day (YYYY-MM-DD): English name, Chinese name, passport no. */
export function daySummary(board: D90Board, day: string): string {
  const list = board.cases.filter((c) => bkkDay(c.passport.ts) === day);
  const head = `📥 รับงาน 90 วัน · ${dayLabelTh(day)} · ${list.length} คน\n90天报到 · ${dayLabelZh(day)} · 共${list.length}人`;
  if (!list.length) return head;
  const rows = list.map((c, i) => `${i + 1}. ${[c.passport.name || "⚠️ (อ่านชื่อไม่ออก)", c.passport.cn, c.passport.passportNo].filter(Boolean).join(" ")}`);
  return `${head}\n\n${rows.join("\n")}`;
}

/** numbered list of every job whose NEW slip came back on one Bangkok day — what goes back to the customer */
export function returnSummary(board: D90Board, day: string): string {
  const list = board.cases.filter((c) => c.slip && bkkDay(c.slip.ts) === day);
  const orphans = board.orphanSlips.filter((s) => bkkDay(s.ts) === day);
  const head = `✅ ส่งงาน 90 วัน · ${dayLabelTh(day)} · ${list.length} คน\n90天报到已完成 · ${dayLabelZh(day)} · 共${list.length}人`;
  const rows = list.map((c, i) => {
    const who = [c.passport.name || "⚠️ (อ่านชื่อไม่ออก)", c.passport.cn, c.passport.passportNo].filter(Boolean).join(" ");
    const due = dueZh(c.slip!.nextDue);
    return `${i + 1}. ${who}${due ? ` · 下次报到 ${due}` : ""}`;
  });
  const tail = orphans.length ? `⚠️ ใบที่ยังไม่จับคู่ ${orphans.length} ใบ (ยังไม่นับ): ${orphans.map((s) => s.name || "ไม่มีชื่อ").join(", ")}` : "";
  return [head, rows.join("\n"), tail].filter(Boolean).join("\n\n");
}

/**
 * What a text in the inbox group asks for:
 *   "สรุป" → jobs received ("in"), "สรุปส่ง" / "ส่งงาน" → slips returned ("out");
 *   either may name a day: "สรุปส่ง 13", "สรุป 13/11", "สรุป เมื่อวาน". Default today.
 */
export function summaryRequest(text: string, now: number): { type: "in" | "out"; day: string } | null {
  const t = text.trim();
  const out = t.match(/^(?:สรุป\s*ส่ง(?:งาน)?|ส่งงาน|สรุป\s*ใบ|已完成|完成)\s*(.*)$/i);
  if (out) return { type: "out", day: dayFrom(out[1], now) };
  const day = summaryDay(t, now);
  return day ? { type: "in", day } : null;
}

/** "สรุป", "สรุป 13", "สรุป 13/11", "สรุป เมื่อวาน" → the Bangkok day asked for (default today); null when it isn't a summary request */
export function summaryDay(text: string, now: number): string | null {
  const m = text.trim().match(/^(?:สรุป|总结|汇总|summary)\s*(.*)$/i);
  if (!m) return null;
  return dayFrom(m[1], now);
}

function dayFrom(restRaw: string, now: number): string {
  const rest = restRaw.trim();
  const today = bkkDay(now);
  if (/^(เมื่อวาน|昨天|yesterday)/i.test(rest)) return bkkDay(now - 86400000);
  const d = rest.match(/^(\d{1,2})(?:[\/.\-](\d{1,2}))?/);
  if (!d) return today;
  const [y, mo] = today.split("-").map(Number);
  const day = +d[1], month = d[2] ? +d[2] : mo;
  if (day < 1 || day > 31 || month < 1 || month > 12) return today;
  // a month later than this one can only mean last year
  const year = month > mo ? y - 1 : y;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function searchCases(board: D90Board, q: string): D90Case[] {
  const tokens = nameTokens(q), pp = ppKey(q), zh = cjkOnly(q);
  if (hasCjk(q)) return zh ? board.cases.filter((c) => cjkOnly(c.passport.cn ?? "").includes(zh)) : [];
  if (!tokens.length && !pp) return [];
  return board.cases.filter((c) => {
    const hay = nameTokens(`${c.passport.name} ${c.slip?.name ?? ""}`).join(" ");
    const byName = tokens.length > 0 && tokens.every((t) => hay.includes(t));
    const byPp = pp.length >= 4 && ppKey(c.passport.passportNo).includes(pp);
    return byName || byPp;
  });
}
