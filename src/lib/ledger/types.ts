// =============================================================
// Agent ledger (📒 บัญชีอาเต่า) — shared types + the price rules
// =============================================================
// One running account per agent book: what the agent has transferred to us
// (slip rounds + cash their customers paid at the counter) against what we
// charge for each day's work (read straight off the day boards and the
// 90-day inbox, priced with the table below). Carry-out of one day is the
// carry-in of the next. Positive balance = the agent's money still with us;
// negative = the agent owes us.

export type LedgerBook = "ARTAO";
export const LEDGER_BOOKS: Record<LedgerBook, { agent: string; label: string; slipBook: "ARTAO" }> = {
  ARTAO: { agent: "อาเต่า", label: "บัญชีอาเต่า", slipBook: "ARTAO" },
};
export const isLedgerBook = (s: unknown): s is LedgerBook => typeof s === "string" && s in LEDGER_BOOKS;

export type Prices = {
  extBANGKOK: number;        // ต่อ 30 วัน IT
  extNONTHABURI: number;     // ต่อ 30 วัน นนท์
  extRAYONG: number;         // ต่อ 30 วัน ระยอง
  vfs: number;               // VFS (BKK / Pattaya)
  vip: number;               // VIP lane (+ per person) — charged to the agent when chargeVip
  chargeVip: boolean;
  runSolo: number;           // visa run, car with one passenger
  runShared: number;         // visa run, per person when the car has 2+ passengers
  run30: number;             // 🐰 + 30-day extension after the border, per person
  cambodia: number;          // 🐻 Cambodia history, per person
  overstayBase: number;      // overstay handling, per person
  overstayPerDay: number;    // fine per day actually overstayed
  d90: number;               // 90-day report, per slip
  chargeD90: boolean;        // the 90-day inbox belongs to this agent
};

export const DEFAULT_PRICES: Prices = {
  extBANGKOK: 3700,
  extNONTHABURI: 4700,
  extRAYONG: 4700,
  vfs: 3200,
  vip: 500,
  chargeVip: true,
  runSolo: 10000,
  runShared: 9500,
  run30: 4500,
  cambodia: 7500,
  overstayBase: 2000,
  overstayPerDay: 500,
  d90: 1000,
  chargeD90: true,
};

export const PRICE_LABELS: Record<keyof Prices, string> = {
  extBANGKOK: "ต่อ 30 วัน IT Square",
  extNONTHABURI: "ต่อ 30 วัน นนทบุรี",
  extRAYONG: "ต่อ 30 วัน ระยอง",
  vfs: "VFS (กรุงเทพ / พัทยา)",
  vip: "VIP (+ ต่อคน)",
  chargeVip: "คิด VIP กับเอเย่นต์ด้วย",
  runSolo: "Visa Run — รถ 1 คัน มี 1 คน",
  runShared: "Visa Run — ต่อคน เมื่อ 2 คนขึ้นไป",
  run30: "🐰 +30 วัน (ต่อคน)",
  cambodia: "🐻 ประวัติกัมพูชา (ต่อคน)",
  overstayBase: "Overstay — ค่าดำเนินการ (ต่อคน)",
  overstayPerDay: "Overstay — ค่าปรับต่อวัน",
  d90: "รายงานตัว 90 วัน (ต่อใบที่สำเร็จ — นับวันที่ใบใหม่กลับมาจับคู่)",
  chargeD90: "งาน 90 วันในกล่องรับงาน = ของเอเย่นต์นี้",
};

export type LedgerConfig = {
  prices: Prices;
  opening: { day: string; amount: number };   // YYYY-MM-DD, balance at the START of that day (positive = agent's money with us)
  lineGroupId?: string;                       // where "📋 ตัดจบ" is pushed
  updatedAt?: string;
};

export type Adjustment = { id: string; label: string; amount: number };  // + = money in / credit to the agent, − = extra charge

/** Hand-edited part of a day (small JSON, one per day). */
export type DayEdits = {
  adjustments: Adjustment[];
  note: string;
  closedAt?: string;          // ISO — once closed, `snapshot` is used instead of re-reading the boards
  snapshot?: DayComputed;
};

export type ChargeLine = {
  id: string;                 // person id / case id
  src: "ext" | "run" | "d90";
  office: string;             // OfficeId or "" for d90
  name: string;
  passport: string;
  items: { label: string; amount: number }[];
  amount: number;             // sum of items
  paidDirect: number;         // THB this person's customer paid us at the counter (cash / transfer) → credited to the agent
  flags: string;              // 👑 🐰 🐻 🐢 …
};

export type CreditLine = { id: string; kind: "slip" | "direct"; label: string; amount: number; time?: string };

export type DayComputed = {
  day: string;                // YYYY-MM-DD
  charges: ChargeLine[];
  credits: CreditLine[];      // slips + direct payments (direct ones mirror paidDirect on the charge lines)
  chargeTotal: number;
  creditTotal: number;
  computedAt: string;
};

export type DayLedger = DayComputed & {
  carryIn: number;
  adjustments: Adjustment[];
  adjustTotal: number;
  carryOut: number;           // carryIn + creditTotal + adjustTotal − chargeTotal
  note: string;
  closedAt?: string;
};

export const money = (n: number) => (Math.round(n) === n ? n.toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const signed = (n: number) => (n < 0 ? `−${money(-n)}` : `+${money(n)}`);
export const dayTh = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
export const addDays = (day: string, n: number) => new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + n)).toISOString().slice(0, 10);
export const bkkToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

/** The closing message pasted / pushed to the agent's LINE group. */
export function closingText(book: LedgerBook, d: DayLedger): string {
  const L: string[] = [];
  L.push(`📒 ${LEDGER_BOOKS[book].label} · ตัดยอด ${dayTh(d.day)}`);
  L.push(`ยกมา: ${money(d.carryIn)}`);
  const slips = d.credits.filter((c) => c.kind === "slip");
  const direct = d.credits.filter((c) => c.kind === "direct");
  if (slips.length) L.push(`โอนเข้า ${slips.length} รายการ: +${money(slips.reduce((s, c) => s + c.amount, 0))}`);
  if (direct.length) L.push(`ลูกค้าจ่ายหน้างาน ${direct.length} คน: +${money(direct.reduce((s, c) => s + c.amount, 0))}`);
  for (const a of d.adjustments) L.push(`${a.label || "ปรับยอด"}: ${signed(a.amount)}`);
  if (d.charges.length) {
    L.push(`ค่างานวันนี้ ${d.charges.length} รายการ: −${money(d.chargeTotal)}`);
    for (const c of d.charges) L.push(`  • ${c.name || c.passport || c.id}${c.flags ? " " + c.flags : ""} — ${c.items.map((i) => i.label).join(" + ")} = ${money(c.amount)}`);
  } else L.push("ค่างานวันนี้: 0");
  L.push(`คงเหลือยกไป: ${money(d.carryOut)}${d.carryOut < 0 ? " (ค้างชำระ)" : ""}`);
  if (d.note.trim()) L.push(`หมายเหตุ: ${d.note.trim()}`);
  return L.join("\n");
}
