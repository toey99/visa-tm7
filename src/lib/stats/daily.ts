// =============================================================
// Daily stats — a permanent, name-free snapshot of each day's work
// =============================================================
// Boards are purged after a week; this keeps what the dashboard needs for
// years: one row per person (office, type, agent, flags, payment) with no
// names or passport numbers, plus the 90-day reports finished that day.
//   stats/YYYY-MM-DD.json   { day, rows, d90, builtAt, final }
// Money is NOT stored — sale and cost are priced at read time from
// pricing/config.json, so a corrected price re-prices history too.
import { blobGetJson, blobPut } from "@/lib/blob";
import { boardFolder, loadManifest, readRecords, type PersonRec } from "@/lib/day-server";
import { peekItems } from "@/lib/d90/store";
import { bkkDay, buildCases } from "@/lib/d90/types";
import { OFFICE_IDS, type OfficeId } from "@/lib/offices";
import { overstayInfo, type PersonFields } from "@/lib/today/types";
import { DEFAULT_PRICING, extSale, runSale, withDefaults, type Pricing } from "./pricing";

export type StatRow = {
  ns: "days" | "run";
  office: OfficeId;
  agent: string;            // main agent ("" = direct / unknown)
  sub: string;              // sub-agent note
  run30: boolean;
  cambodia: boolean;
  indian: boolean;          // Indian passport (visa run costs more)
  vip: boolean;
  overstayDays: number;
  carSize: number;          // run only: how many rode in that car (0 = no car set)
  arrived: boolean;
  cancelled: boolean;
  moved: boolean;
  pay: string;              // collect | paid | nocollect | hold | ""
  paidHow: string;          // cash | transfer | waiting | agent | pending | ""
  amount: number;           // what the card says to collect from the customer
  paidAmount: number;       // what was actually received at the counter
};
export type DayStats = { day: string; rows: StatRow[]; d90: number; builtAt: string; final: boolean };

const PRICING = "pricing/config.json";
export async function loadPricing(): Promise<Pricing> { return withDefaults(await blobGetJson<Partial<Pricing>>(PRICING)); }
export async function savePricing(p: Pricing): Promise<void> { await blobPut(PRICING, JSON.stringify({ ...p, updatedAt: new Date().toISOString() }), "application/json"); }

const statsPath = (day: string) => `stats/${day}.json`;
const toKey = (day: string) => `${day.slice(8, 10)}${day.slice(5, 7)}${day.slice(0, 4)}`;
const toDdmmyyyy = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
export const bkkToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + n)).toISOString().slice(0, 10);
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^\d.-]/g, "")); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown) => (typeof v === "string" ? v : "");

async function boardRows(ns: "days" | "run", day: string, office: OfficeId): Promise<StatRow[]> {
  const folder = boardFolder(ns, toKey(day), office);
  const m = await loadManifest(ns, toKey(day), office, folder);
  if (!m) return [];
  const recs = await readRecords(folder, Object.keys(m.entries));
  const perCar = new Map<string, number>();
  if (ns === "run") for (const p of recs) { if (p.cancelled || p.movedTo) continue; const car = str(p.fields?.car); if (car) perCar.set(car, (perCar.get(car) ?? 0) + 1); }
  return recs.map((p: PersonRec): StatRow => {
    const f = (p.fields ?? {}) as Partial<PersonFields> & Record<string, unknown>;
    let overstayDays = Math.max(0, Math.floor(num(f.overstayDays)));
    if (f.overstay && !overstayDays) overstayDays = overstayInfo(str(f.arrivalDate), str(f.admittedUntil), str(f.visaType), toDdmmyyyy(day), undefined, ns === "days")?.days ?? 0;
    return {
      ns, office,
      agent: str(f.agent).trim(), sub: str(f.subAgent).trim(),
      run30: f.run === "RUN30", cambodia: !!f.cambodia, indian: /india/i.test(str(f.nationality)), vip: !!f.vip, overstayDays,
      carSize: ns === "run" ? (perCar.get(str(f.car)) ?? 0) : 0,
      arrived: !!p.arrived, cancelled: !!p.cancelled, moved: !!p.movedTo,
      pay: str(f.pay), paidHow: str(f.paidHow), amount: num(f.amount), paidAmount: num(f.paidAmount),
    };
  });
}

/** Build the day's snapshot from the live boards + the 90-day inbox. */
export async function buildDayStats(day: string): Promise<DayStats> {
  const parts = await Promise.all([
    ...OFFICE_IDS.filter((o) => o !== "CHIANG_SAEN").map((o) => boardRows("days", day, o)),
    ...OFFICE_IDS.map((o) => boardRows("run", day, o)),
  ]);
  let d90 = 0;
  try { d90 = buildCases(await peekItems()).cases.filter((c) => c.slip && bkkDay(c.slip.ts) === day).length; } catch { /* inbox unavailable */ }
  return { day, rows: parts.flat(), d90, builtAt: new Date().toISOString(), final: day < bkkToday() };
}

export async function loadDayStats(day: string): Promise<DayStats | null> { return blobGetJson<DayStats>(statsPath(day)); }

/** Snapshot one day (rebuilds unless already final, or when forced). */
export async function snapshotDay(day: string, force = false): Promise<DayStats> {
  const have = force ? null : await loadDayStats(day);
  if (have?.final) return have;
  const s = await buildDayStats(day);
  await blobPut(statsPath(day), JSON.stringify(s), "application/json");
  return s;
}

/** Stats for a range: stored snapshots where final, live otherwise (today always live). */
export async function statsRange(from: string, to: string): Promise<DayStats[]> {
  const out: DayStats[] = [];
  const today = bkkToday();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d > today) break;
    const have = await loadDayStats(d);
    if (have && (have.final || d < today)) { out.push(have); continue; }
    if (d === today) { out.push(await buildDayStats(d)); continue; }
    // a past day never snapshotted: boards may still exist (7-day window) → build and store
    out.push(await snapshotDay(d));
    if (out.length > 400) break;
  }
  return out;
}

// ---------- pricing a row ----------
export type Priced = { sale: number; cost: number; collected: number };

export function priceRow(r: StatRow, p: Pricing = DEFAULT_PRICING): Priced {
  if (r.cancelled || r.moved) return { sale: 0, cost: 0, collected: 0 };
  let sale = 0, cost = 0;
  if (r.ns === "days") {
    sale += extSale(p, r.office, r.agent);
    cost += p.cost.ext[r.office] ?? 0;
  } else {
    const solo = r.carSize === 1;
    sale += runSale(p, r.agent, solo, r.indian);
    const n = (Math.min(4, Math.max(1, r.carSize || 2)) as 1 | 2 | 3 | 4);
    cost += p.cost.runPerHead[n] ?? p.cost.runPerHead[2];
    if (r.indian) cost += p.cost.runIndian;
    if (r.run30) { sale += p.sale.run30; cost += p.cost.run30; }
    if (r.cambodia) { sale += p.sale.cambodia; cost += p.cost.cambodia; }
  }
  if (r.vip) { sale += p.sale.vip; cost += p.cost.vip; }
  if (r.overstayDays > 0) { sale += p.sale.overstayBase + p.sale.overstayPerDay * r.overstayDays; cost += p.cost.overstayPerDay * r.overstayDays; }
  const collected = r.pay === "collect" && (r.paidHow === "cash" || r.paidHow === "transfer") ? (r.paidAmount || r.amount) : 0;
  return { sale, cost, collected };
}

export type DaySummary = {
  day: string;
  people: number; arrived: number; cancelled: number; vip: number; overstay: number; run: number; run30: number;
  byOffice: Record<string, number>;
  byAgent: Record<string, { people: number; sale: number; cost: number }>;
  sale: number; cost: number; profit: number; collected: number; toCollect: number; waiting: number; hold: number;
  d90: number;
  jobs?: number;            // long-stay visa jobs filed that day
};

export function summarize(s: DayStats, p: Pricing): DaySummary {
  const live = s.rows.filter((r) => !r.cancelled && !r.moved);
  const out: DaySummary = {
    day: s.day, people: live.length, arrived: live.filter((r) => r.arrived).length, cancelled: s.rows.filter((r) => r.cancelled).length,
    vip: live.filter((r) => r.vip).length, overstay: live.filter((r) => r.overstayDays > 0).length,
    run: live.filter((r) => r.ns === "run").length, run30: live.filter((r) => r.run30).length,
    byOffice: {}, byAgent: {}, sale: 0, cost: 0, profit: 0, collected: 0, toCollect: 0, waiting: 0, hold: 0, d90: s.d90,
  };
  for (const r of live) {
    const key = r.ns === "run" ? "RUN" : r.office;
    out.byOffice[key] = (out.byOffice[key] ?? 0) + 1;
    const pr = priceRow(r, p);
    const a = r.agent || "ลูกค้าตรง";
    const ag = (out.byAgent[a] ??= { people: 0, sale: 0, cost: 0 });
    ag.people++; ag.sale += pr.sale; ag.cost += pr.cost;
    out.sale += pr.sale; out.cost += pr.cost; out.collected += pr.collected;
    if (r.pay === "collect" && (r.paidHow === "" || r.paidHow === "pending")) out.toCollect += r.amount;
    if (r.pay === "collect" && r.paidHow === "waiting") out.waiting += r.amount;
    if (r.pay === "hold") out.hold++;
  }
  out.sale += s.d90 * p.sale.d90; out.cost += s.d90 * p.cost.d90;
  if (s.d90) { const ag = (out.byAgent["อาเต่า"] ??= { people: 0, sale: 0, cost: 0 }); ag.sale += s.d90 * p.sale.d90; ag.cost += s.d90 * p.cost.d90; }
  out.profit = out.sale - out.cost;
  return out;
}
