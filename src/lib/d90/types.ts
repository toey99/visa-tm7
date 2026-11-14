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
  done?: boolean;      // passports only: closed by hand without a slip
  note?: string;
};

export type D90Group = { name: string; status: "pending" | "allowed"; ts: number };

export type D90Case = {
  passport: D90Item;
  pages: D90Item[];    // other pages sent with it (entry stamp, visa…)
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

export function buildCases(items: D90Item[]): D90Board {
  const sorted = [...items].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  const cases: D90Case[] = sorted.filter((i) => i.kind === "passport").map((p) => ({ passport: p, pages: [], slip: null, how: "" }));
  const byId = new Map(cases.map((c) => [c.passport.id, c]));

  // extra pages → same image set, else the passport sent just before in the same group
  const loose: D90Item[] = [];
  for (const o of sorted.filter((i) => i.kind === "other")) {
    let home = o.setId ? cases.find((c) => c.passport.setId === o.setId) : undefined;
    if (!home) {
      for (const c of cases) {
        if (c.passport.groupId !== o.groupId || c.passport.ts > o.ts) continue;
        if (o.ts - c.passport.ts <= PAGE_WINDOW_MS) home = c; // keeps the latest one before it
      }
    }
    if (home) home.pages.push(o); else loose.push(o);
  }

  // slips → manual link, passport number, exact name, spacing-insensitive name, one-letter slip
  const orphanSlips: D90Item[] = [];
  const slips = sorted.filter((i) => i.kind === "slip");
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
