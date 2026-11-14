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

/** The closing message — same shape as the hand-written one (charges by type, visa run by name, cash / transfers, previous balance, totals). */
export function closingText(book: LedgerBook, d: DayLedger): string {
  const L: string[] = [];
  const f = (n: number) => money(n);
  L.push(`${dayTh(d.day)} · ${LEDGER_BOOKS[book].label}`);
  L.push("");
  const payParts: string[] = [];

  // extension work: one line per office at the base price, VIP and overstay extras pulled out
  const ext = d.charges.filter((c) => c.src === "ext");
  const byOffice = new Map<string, { label: string; price: number; n: number }>();
  let vipN = 0, vipSum = 0;
  const extras: string[] = [];
  let extrasSum = 0;
  for (const c of ext) {
    const base = c.items[0];
    const k = `${c.office}|${base.amount}`;
    const g = byOffice.get(k) ?? { label: base.label, price: base.amount, n: 0 };
    g.n++; byOffice.set(k, g);
    for (const it of c.items.slice(1)) {
      if (it.label === "VIP") { vipN++; vipSum += it.amount; }
      else { extras.push(`${c.name} ${it.label} ${f(it.amount)}`); extrasSum += it.amount; }
    }
  }
  for (const g of byOffice.values()) { L.push(`${g.label} ${g.price}*${g.n} = ${f(g.price * g.n)}`); payParts.push(f(g.price * g.n)); }
  if (vipN) { L.push(`vip ${vipN} คน 500*${vipN} = ${f(vipSum)}`); payParts.push(f(vipSum)); }
  for (const x of extras) L.push(x);
  if (extrasSum) payParts.push(f(extrasSum));

  const d90 = d.charges.filter((c) => c.src === "d90");
  if (d90.length) { const sum = d90.reduce((s, c) => s + c.amount, 0); L.push(""); L.push(`รายงานตัว 90 วัน ${d90.length} ใบ`); L.push(`${d90[0].amount}*${d90.length} = ${f(sum)}`); payParts.push(f(sum)); }

  const run = d.charges.filter((c) => c.src === "run");
  if (run.length) {
    L.push(""); L.push(`วนด่าน ${d.day.slice(8, 10)}/${Number(d.day.slice(5, 7))}`);
    for (const c of run) {
      const base = c.items.filter((i) => !i.label.startsWith("overstay") && !i.label.startsWith("ค่าปรับ")).reduce((s, i) => s + i.amount, 0);
      const over = c.amount - base;
      L.push(`${c.name}${c.flags ? " " + c.flags : ""} ${over ? `${f(base)}+ค่าover${f(over)}=${f(c.amount)}` : f(c.amount)}`);
    }
    const sum = run.reduce((s, c) => s + c.amount, 0);
    L.push(`รวมวนด่าน ${f(sum)}`); payParts.push(f(sum));
  }

  const minus = d.adjustments.filter((a) => a.amount < 0);
  for (const a of minus) { L.push(`${a.label || "หักเพิ่ม"} ${f(-a.amount)}`); payParts.push(f(-a.amount)); }
  const pay = d.chargeTotal + minus.reduce((s, a) => s - a.amount, 0);
  L.push(""); L.push("จ่ายรวม"); L.push(payParts.length > 1 ? `${payParts.join("+")} = ${f(pay)}` : f(pay));

  // money in
  const recvParts: string[] = [];
  L.push("");
  const direct = d.credits.filter((c) => c.kind === "direct");
  if (direct.length) {
    L.push("เงินสด✅");
    const byOff = new Map<string, number[]>();
    for (const c of direct) { const ch = d.charges.find((x) => `direct-${x.id}` === c.id); const o = ch ? (ch.src === "run" ? "เชียงแสน" : OFFICE_NOTE[ch.office] ?? ch.office) : "หน้างาน"; byOff.set(o, [...(byOff.get(o) ?? []), c.amount]); }
    for (const [o, amts] of byOff) {
      const sum = amts.reduce((s, a) => s + a, 0);
      const same = amts.every((a) => a === amts[0]);
      L.push(amts.length > 1 ? (same ? `${o} ${f(amts[0])}*${amts.length} = ${f(sum)}` : `${o} ${amts.map(f).join("+")} = ${f(sum)}`) : `${o} ${f(sum)}`);
      recvParts.push(f(sum));
    }
  }
  const slips = d.credits.filter((c) => c.kind === "slip");
  if (slips.length) { const sum = slips.reduce((s, c) => s + c.amount, 0); L.push("เงินโอน✅"); L.push(slips.length > 1 ? `${slips.map((c) => f(c.amount)).join("+")} = ${f(sum)}` : f(sum)); recvParts.push(f(sum)); }
  const plus = d.adjustments.filter((a) => a.amount > 0);
  for (const a of plus) { L.push(`${a.label || "ปรับยอด"} ${f(a.amount)}`); recvParts.push(f(a.amount)); }
  if (d.carryIn >= 0) { L.push(`${dayTh(addDays(d.day, -1))} คงเหลือ ${f(d.carryIn)} บาท✅`); recvParts.push(f(d.carryIn)); }
  else L.push(`${dayTh(addDays(d.day, -1))} ค้างชำระ ${f(-d.carryIn)} บาท`);
  const recv = d.creditTotal + plus.reduce((s, a) => s + a.amount, 0) + Math.max(0, d.carryIn);
  L.push(""); L.push("รับรวม"); L.push(recvParts.length > 1 ? `${recvParts.join("+")} = ${f(recv)}` : f(recv));

  L.push(""); L.push(`รวมยอดคงเหลือ ${d.carryOut >= 0 ? "✅" : "⚠️ ค้างชำระ"}`);
  L.push(d.carryIn < 0 ? `${f(recv)}-${f(pay)}-${f(-d.carryIn)} = ${f(d.carryOut)}` : `${f(recv)}-${f(pay)} = ${f(d.carryOut)}`);
  if (d.note.trim()) { L.push(""); L.push(`หมายเหตุ: ${d.note.trim()}`); }
  return L.join("\n");
}

const OFFICE_NOTE: Record<string, string> = { BANGKOK: "IT", NONTHABURI: "นนท์", RAYONG: "ระยอง", CHIANG_SAEN: "เชียงแสน", VFS_BANGKOK: "VFS", VFS_PATTAYA: "VFS พัทยา" };
