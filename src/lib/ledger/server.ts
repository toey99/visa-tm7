// =============================================================
// Agent ledger — server side: storage + the daily computation
// =============================================================
//   ledger/<BOOK>/config.json          prices, opening balance, LINE group
//   ledger/<BOOK>/days/<YYYY-MM-DD>.json  hand edits (adjustments, note) and, once
//                                          closed, a frozen snapshot of the day
// A day is computed live from the boards (days/ + run/ for every office), the
// transfer-slip room and the 90-day inbox. Boards are purged after a week, so
// days older than yesterday are frozen automatically the first time they are
// read — the running balance never depends on a board that has disappeared.
import { blobGetJson, blobPut } from "@/lib/blob";
import { boardFolder, loadManifest, readRecords, type PersonRec } from "@/lib/day-server";
import { peekItems } from "@/lib/d90/store";
import { bkkDay, buildCases } from "@/lib/d90/types";
import { OFFICE_IDS, type OfficeId } from "@/lib/offices";
import { listSlips } from "@/lib/slips/store";
import { bkkTime, counted } from "@/lib/slips/types";
import { overstayInfo } from "@/lib/today/types";
import {
  addDays, bkkToday, DEFAULT_PRICES, LEDGER_BOOKS, type Adjustment, type ChargeLine, type CreditLine, type DayComputed, type DayEdits,
  type DayLedger, type LedgerBook, type LedgerConfig, type Prices,
} from "./types";

const root = (book: LedgerBook) => `ledger/${book}/`;
const cfgPath = (book: LedgerBook) => `${root(book)}config.json`;
const dayPath = (book: LedgerBook, day: string) => `${root(book)}days/${day}.json`;
export const safeDay = (d: unknown) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
const toKey = (day: string) => `${day.slice(8, 10)}${day.slice(5, 7)}${day.slice(0, 4)}`;   // YYYY-MM-DD → DDMMYYYY (board folder)
const toDdmmyyyy = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown) => (typeof v === "string" ? v : "");
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");

export async function loadLedgerConfig(book: LedgerBook): Promise<LedgerConfig> {
  const c = await blobGetJson<LedgerConfig>(cfgPath(book));
  const prices: Prices = { ...DEFAULT_PRICES, ...(c?.prices ?? {}) };
  return { prices, opening: c?.opening ?? { day: bkkToday(), amount: 0 }, lineGroupId: c?.lineGroupId, updatedAt: c?.updatedAt };
}
export async function saveLedgerConfig(book: LedgerBook, c: LedgerConfig): Promise<void> {
  await blobPut(cfgPath(book), JSON.stringify({ ...c, updatedAt: new Date().toISOString() }), "application/json");
}
export async function loadDayEdits(book: LedgerBook, day: string): Promise<DayEdits> {
  const e = await blobGetJson<DayEdits>(dayPath(book, day));
  return { adjustments: e?.adjustments ?? [], note: e?.note ?? "", closedAt: e?.closedAt, snapshot: e?.snapshot };
}
export async function saveDayEdits(book: LedgerBook, day: string, e: DayEdits): Promise<void> {
  await blobPut(dayPath(book, day), JSON.stringify(e), "application/json");
}

const isAgent = (fields: Record<string, unknown> | undefined, agent: string) => norm(str(fields?.agent)) === norm(agent);
const active = (p: PersonRec) => !p.cancelled && !p.movedTo;

function overstayItems(f: Record<string, unknown>, day: string, prices: Prices, grace: boolean): { label: string; amount: number }[] {
  if (!f.overstay) return [];
  let days = Math.max(0, Math.floor(num(f.overstayDays)));
  if (!days) {
    const info = overstayInfo(str(f.arrivalDate), str(f.admittedUntil), str(f.visaType), toDdmmyyyy(day), undefined, grace);
    days = info?.days ?? 0;
  }
  const items = [{ label: "overstay", amount: prices.overstayBase }];
  if (days) items.push({ label: `ค่าปรับ ${days} วัน`, amount: days * prices.overstayPerDay });
  return items;
}

function paidDirect(f: Record<string, unknown>): number {
  const how = str(f.paidHow);
  if (how !== "cash" && how !== "transfer") return 0;
  return num(f.paidAmount) || num(f.amount);
}

function personName(f: Record<string, unknown>): string {
  const en = [str(f.firstName), str(f.lastName)].filter(Boolean).join(" ").trim();
  return en || str(f.chineseName) || str(f.passportNo);
}

async function readBoard(ns: "days" | "run", day: string, office: OfficeId): Promise<PersonRec[]> {
  const folder = boardFolder(ns, toKey(day), office);
  const m = await loadManifest(ns, toKey(day), office, folder);
  if (!m) return [];
  return readRecords(folder, Object.keys(m.entries));
}

/** Compute one day live from the boards, the slip room and the 90-day inbox. */
export async function computeDay(book: LedgerBook, day: string, prices: Prices): Promise<DayComputed> {
  const { agent, slipBook } = LEDGER_BOOKS[book];
  const charges: ChargeLine[] = [];
  const credits: CreditLine[] = [];

  // extension boards
  await Promise.all(OFFICE_IDS.map(async (office) => {
    if (office === "CHIANG_SAEN") return;
    const people = await readBoard("days", day, office);
    for (const p of people.filter(active)) {
      const f = p.fields ?? {};
      if (!isAgent(f, agent)) continue;
      const base = office === "BANGKOK" ? prices.extBANGKOK : office === "NONTHABURI" ? prices.extNONTHABURI : office === "RAYONG" ? prices.extRAYONG : prices.vfs;
      const items = [{ label: office.startsWith("VFS") ? "VFS" : `ต่อ 30 วัน ${office === "BANGKOK" ? "IT" : office === "NONTHABURI" ? "นนท์" : "ระยอง"}`, amount: base }];
      if (f.vip && prices.chargeVip) items.push({ label: "VIP", amount: prices.vip });
      items.push(...overstayItems(f, day, prices, true));
      const flags = [f.vip ? "👑" : "", f.overstay ? "🐢" : ""].filter(Boolean).join("");
      charges.push({ id: p.id, src: "ext", office, name: personName(f), passport: str(f.passportNo), items, amount: items.reduce((s, i) => s + i.amount, 0), paidDirect: paidDirect(f), flags });
    }
  }));

  // visa-run boards — the car price depends on how many ride in the car (any agent)
  await Promise.all(OFFICE_IDS.map(async (office) => {
    const people = (await readBoard("run", day, office)).filter(active);
    if (!people.length) return;
    const perCar = new Map<string, number>();
    for (const p of people) { const car = str(p.fields?.car); perCar.set(car, (perCar.get(car) ?? 0) + 1); }
    for (const p of people) {
      const f = p.fields ?? {};
      if (!isAgent(f, agent)) continue;
      const car = str(f.car);
      const solo = !!car && perCar.get(car) === 1;
      const items = [{ label: solo ? "วีซ่ารัน (รถ 1 คน)" : "วีซ่ารัน", amount: solo ? prices.runSolo : prices.runShared }];
      if (f.run === "RUN30") items.push({ label: "🐰 +30 วัน", amount: prices.run30 });
      if (f.cambodia) items.push({ label: "🐻 กัมพูชา", amount: prices.cambodia });
      items.push(...overstayItems(f, day, prices, false));
      const flags = [f.run === "RUN30" ? "🐰" : "", f.cambodia ? "🐻" : "", f.overstay ? "🐢" : "", f.vip ? "👑" : ""].filter(Boolean).join("");
      charges.push({ id: p.id, src: "run", office, name: personName(f), passport: str(f.passportNo), items, amount: items.reduce((s, i) => s + i.amount, 0), paidDirect: paidDirect(f), flags });
    }
  }));

  // 90-day reports received that day
  if (prices.chargeD90) {
    try {
      const board = buildCases(await peekItems());
      for (const c of board.cases.filter((c) => bkkDay(c.passport.ts) === day)) {
        charges.push({ id: c.passport.id, src: "d90", office: "", name: c.passport.name, passport: c.passport.passportNo, items: [{ label: "90 วัน", amount: prices.d90 }], amount: prices.d90, paidDirect: 0, flags: "" });
      }
    } catch { /* inbox unavailable → no 90-day lines; the day can be closed by hand */ }
  }

  // transfers in (slip room, that round)
  const slips = (await listSlips(slipBook, day)).filter(counted).sort((a, b) => a.ts - b.ts);
  for (const s of slips) credits.push({ id: s.id, kind: "slip", label: [s.sender, s.ref].filter(Boolean).join(" · ") || "สลิปโอน", amount: s.amount, time: bkkTime(s.ts) });
  for (const c of charges) if (c.paidDirect) credits.push({ id: `direct-${c.id}`, kind: "direct", label: `${c.name} จ่ายหน้างาน`, amount: c.paidDirect });

  charges.sort((a, b) => a.src.localeCompare(b.src) || a.office.localeCompare(b.office) || a.name.localeCompare(b.name));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    day, charges, credits,
    chargeTotal: r2(charges.reduce((s, c) => s + c.amount, 0)),
    creditTotal: r2(credits.reduce((s, c) => s + c.amount, 0)),
    computedAt: new Date().toISOString(),
  };
}

const withEdits = (c: DayComputed, e: DayEdits, carryIn: number): DayLedger => {
  const adjustTotal = e.adjustments.reduce((s, a) => s + (Number.isFinite(a.amount) ? a.amount : 0), 0);
  return { ...c, carryIn, adjustments: e.adjustments, adjustTotal, carryOut: Math.round((carryIn + c.creditTotal + adjustTotal - c.chargeTotal) * 100) / 100, note: e.note, closedAt: e.closedAt };
};

/**
 * The ledger from the opening day up to `to` (inclusive). Days up to the day
 * before yesterday are frozen on first read; today and yesterday are live.
 */
export async function ledgerRange(book: LedgerBook, to: string, cfg?: LedgerConfig): Promise<{ config: LedgerConfig; days: DayLedger[] }> {
  const config = cfg ?? (await loadLedgerConfig(book));
  const start = config.opening.day <= to ? config.opening.day : to;
  const freezeBefore = addDays(bkkToday(), -1);   // < yesterday → freeze
  const out: DayLedger[] = [];
  let carry = config.opening.amount;
  // walk day by day; snapshots make old days free, live days hit the boards
  for (let day = start; day <= to; day = addDays(day, 1)) {
    const edits = await loadDayEdits(book, day);
    let comp = edits.closedAt && edits.snapshot ? edits.snapshot : null;
    if (!comp) {
      comp = await computeDay(book, day, config.prices);
      if (day < freezeBefore) {
        edits.closedAt = new Date().toISOString();
        edits.snapshot = comp;
        await saveDayEdits(book, day, edits);
      }
    }
    const d = withEdits(comp, edits, carry);
    out.push(d);
    carry = d.carryOut;
    if (out.length > 400) break;   // safety — a year of days at most
  }
  return { config, days: out };
}

export async function updateDay(book: LedgerBook, day: string, patch: { adjustments?: Adjustment[]; note?: string; close?: boolean; reopen?: boolean }, prices: Prices): Promise<DayEdits> {
  const e = await loadDayEdits(book, day);
  if (patch.adjustments) e.adjustments = patch.adjustments.filter((a) => a && typeof a.id === "string").map((a) => ({ id: a.id.slice(0, 40), label: String(a.label ?? "").slice(0, 120), amount: Number.isFinite(Number(a.amount)) ? Number(a.amount) : 0 }));
  if (typeof patch.note === "string") e.note = patch.note.slice(0, 2000);
  if (patch.reopen) { delete e.closedAt; delete e.snapshot; }
  if (patch.close) { e.snapshot = await computeDay(book, day, prices); e.closedAt = new Date().toISOString(); }
  await saveDayEdits(book, day, e);
  return e;
}
