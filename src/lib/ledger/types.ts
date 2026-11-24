// =============================================================
// Agent ledger (📒 บัญชีอาเต่า) — shared types + the price rules
// =============================================================
// One running account per agent book: what the agent has transferred to us
// (slip rounds + cash their customers paid at the counter) against what we
// charge for each day's work (read straight off the day boards and the
// 90-day inbox, priced with the table below). Carry-out of one day is the
// carry-in of the next. Positive balance = the agent's money still with us;
// negative = the agent owes us.

export type LedgerBook = "ARTAO" | "UU";
// slipBook: the transfer-slip room that feeds the book (null = transfers are typed in as + adjustments)
// statement: the agent gets a running 对账单 (Chinese / English) for a period instead of the Thai daily closing note
export const LEDGER_BOOKS: Record<LedgerBook, { agent: string; label: string; slipBook: "ARTAO" | null; statement?: boolean }> = {
  ARTAO: { agent: "อาเต่า", label: "บัญชีอาเต่า", slipBook: "ARTAO" },
  UU: { agent: "uu", label: "บัญชี uu", slipBook: null, statement: true },
};
export const isLedgerBook = (s: unknown): s is LedgerBook => typeof s === "string" && s in LEDGER_BOOKS;

export type Prices = {
  extBANGKOK: number;        // ต่อ 30 วัน IT
  extNONTHABURI: number;     // ต่อ 30 วัน นนท์
  extRAYONG: number;         // ต่อ 30 วัน ระยอง
  vfs: number;               // VFS กรุงเทพ
  vfsPattaya: number;        // VFS พัทยา
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
  vfsPattaya: 4500,
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

// what a book charges when nothing has been saved for it yet
const BOOK_PRICES: Partial<Record<LedgerBook, Partial<Prices>>> = {
  UU: { extBANGKOK: 3500, extNONTHABURI: 4500, extRAYONG: 4700, vfs: 3200, vfsPattaya: 4500, chargeD90: false },
};
export const defaultPrices = (book: LedgerBook): Prices => ({ ...DEFAULT_PRICES, ...(BOOK_PRICES[book] ?? {}) });

export const PRICE_LABELS: Record<keyof Prices, string> = {
  extBANGKOK: "ต่อ 30 วัน IT Square",
  extNONTHABURI: "ต่อ 30 วัน นนทบุรี",
  extRAYONG: "ต่อ 30 วัน ระยอง",
  vfs: "VFS กรุงเทพ",
  vfsPattaya: "VFS พัทยา",
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
  cn?: string;                // Chinese name, when the card has one (statement books show it first)
  lf?: string;                // passport name, surname first
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
export const dayShort = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;
export const dayTh = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
export const addDays = (day: string, n: number) => new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10) + n)).toISOString().slice(0, 10);
export const bkkToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

/** The closing message — same shape as the hand-written one (charges by type, visa run by name, cash / transfers, previous balance, totals). */
export function closingText(book: LedgerBook, d: DayLedger): string {
  const L: string[] = [];
  const f = (n: number) => money(n);
  L.push(dayTh(d.day));
  L.push("");
  const payParts: string[] = [];

  // extension work: one line per office at the base price, VIP and overstay extras pulled out
  // long-stay / one-off jobs from /jobs (id "job-…") are priced per case: listed by name further down
  const jobs = d.charges.filter((c) => c.src === "ext" && c.id.startsWith("job-"));
  const ext = d.charges.filter((c) => c.src === "ext" && !c.id.startsWith("job-"));
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

  if (jobs.length) {
    const sum = jobs.reduce((s, c) => s + c.amount, 0);
    L.push(""); L.push(`วีซ่ายาว / งานอื่น ${jobs.length} เคส`);
    for (const c of jobs) L.push(`${c.name} ${c.items[0]?.label ?? ""} ${f(c.amount)}`.replace(/\s+/g, " "));
    if (jobs.length > 1) L.push(`รวม ${jobs.map((c) => f(c.amount)).join("+")} = ${f(sum)}`);
    payParts.push(f(sum));
  }

  const d90 = d.charges.filter((c) => c.src === "d90");
  if (d90.length) { const sum = d90.reduce((s, c) => s + c.amount, 0); L.push(""); L.push(`รายงานตัว 90 วัน ${d90.length} ใบ`); L.push(`${d90[0].amount}*${d90.length} = ${f(sum)}`); payParts.push(f(sum)); }

  const run = d.charges.filter((c) => c.src === "run");
  if (run.length) {
    L.push(""); L.push(`วนด่าน ${Number(d.day.slice(8, 10))}/${Number(d.day.slice(5, 7))}`);
    const n30 = run.filter((c) => c.items.some((i) => i.label.startsWith("🐰"))).length;
    const nKh = run.filter((c) => c.items.some((i) => i.label.startsWith("🐻"))).length;
    L.push(`รวม ${run.length} คน${n30 ? ` ต่อ 30 วัน ${n30} คน` : ""}${nKh ? ` กัมพูชา ${nKh} คน` : ""}`);
    const groups = new Map<number, number>();          // base price → count
    const parts: string[] = [];
    for (const c of run) groups.set(c.items[0].amount, (groups.get(c.items[0].amount) ?? 0) + 1);
    for (const [price, n] of [...groups].sort((a, b) => b[0] - a[0])) { L.push(`${price}*${n} = ${f(price * n)}`); parts.push(f(price * n)); }
    const extraSum = (prefix: string) => run.reduce((s, c) => s + c.items.filter((i) => i.label.startsWith(prefix)).reduce((t, i) => t + i.amount, 0), 0);
    const s30 = extraSum("🐰"), sKh = extraSum("🐻");
    if (n30) { L.push(`${s30 / n30}*${n30} = ${f(s30)}`); parts.push(f(s30)); }
    if (nKh) { L.push(`${sKh / nKh}*${nKh} = ${f(sKh)}`); parts.push(f(sKh)); }
    for (const c of run) {
      const over = c.items.filter((i) => i.label.startsWith("overstay") || i.label.startsWith("ค่าปรับ")).reduce((s, i) => s + i.amount, 0);
      if (over) { L.push(`${c.name} ค่าover ${f(over)}`); parts.push(f(over)); }
    }
    const sum = run.reduce((s, c) => s + c.amount, 0);
    L.push(parts.length > 1 ? `รวม ${parts.join("+")} = ${f(sum)}` : `รวม ${f(sum)}`); payParts.push(f(sum));
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
      const byAmt = new Map<number, number>();
      for (const a of amts) byAmt.set(a, (byAmt.get(a) ?? 0) + 1);
      const terms = [...byAmt].sort((a, b) => b[0] - a[0]).map(([a, n]) => (n > 1 ? `${a}*${n}` : f(a)));
      L.push(amts.length > 1 ? (terms.length > 1 ? `${o} ${terms.map((t) => `(${t})`).join("+")} = ${f(sum)}` : `${o} ${terms[0]} = ${f(sum)}`) : `${o} ${f(sum)}`);
      recvParts.push(f(sum));
    }
  }
  const slips = d.credits.filter((c) => c.kind === "slip");
  if (slips.length) { const sum = slips.reduce((s, c) => s + c.amount, 0); L.push("เงินโอน✅"); L.push(slips.length > 1 ? `${slips.map((c) => f(c.amount)).join("+")} = ${f(sum)}` : f(sum)); recvParts.push(f(sum)); }
  const plus = d.adjustments.filter((a) => a.amount > 0);
  for (const a of plus) { L.push(`${a.label || "ปรับยอด"} ${f(a.amount)}`); recvParts.push(f(a.amount)); }
  const prev = dayShort(addDays(d.day, -1));
  if (d.carryIn >= 0) { L.push(`${prev} คงเหลือ ${f(d.carryIn)} บาท✅`); recvParts.push(f(d.carryIn)); }
  else L.push(`${prev} คงเหลือ -${f(-d.carryIn)} บาท⛔`);
  const recv = d.creditTotal + plus.reduce((s, a) => s + a.amount, 0) + d.carryIn;
  L.push(""); L.push("รับรวม");
  L.push(d.carryIn < 0 ? `(${recvParts.join("+")})-${f(-d.carryIn)} = ${f(recv)}` : recvParts.length > 1 ? `${recvParts.join("+")} = ${f(recv)}` : f(recv));

  L.push(""); L.push("รวมยอดคงเหลือ");
  L.push(`${f(recv)}-${f(pay)} = ${d.carryOut < 0 ? `-${f(-d.carryOut)} ติดลบ⛔` : `${f(d.carryOut)}✅`}`);
  if (d.note.trim()) { L.push(""); L.push(`หมายเหตุ: ${d.note.trim()}`); }
  return L.join("\n");
}

const OFFICE_NOTE: Record<string, string> = { BANGKOK: "IT", NONTHABURI: "นนท์", RAYONG: "ระยอง", CHIANG_SAEN: "เชียงแสน", VFS_BANGKOK: "VFS", VFS_PATTAYA: "VFS พัทยา" };

// ---------- statement (对账单) for books whose agent reads Chinese / English ----------
// One row per job, payment or adjustment over a period, with a running
// "balance due" (what the agent owes us; negative = the agent is in credit).
export type StatementRow = { day: string; client: string; sub: string; service: string; fee: number; received: number; due: number; kind: "charge" | "payment" | "extra" };
export type Statement = { from: string; to: string; openingDue: number; rows: StatementRow[]; fees: number; received: number; due: number };

const EXT_ZH: Record<string, string> = {
  BANGKOK: "续签30天 Extension · IT Square", NONTHABURI: "续签30天 Extension · 暖武里 Nonthaburi", RAYONG: "续签30天 Extension · 罗勇 Rayong",
  VFS_BANGKOK: "续签30天 Extension · VFS 曼谷 Bangkok", VFS_PATTAYA: "续签30天 Extension · VFS 芭提雅 Pattaya",
};
function extraZh(label: string): string {
  if (label === "VIP") return "VIP 快速通道";
  if (label === "overstay") return "逾期处理 Overstay";
  const fine = /^ค่าปรับ (\d+) วัน$/.exec(label);
  if (fine) return `逾期罚款 Fine ${fine[1]}天`;
  if (label.startsWith("🐰")) return "+30天续签 Extension";
  if (label.startsWith("🐻")) return "柬埔寨记录 Cambodia";
  return label;
}
export function serviceZh(c: ChargeLine): string {
  const base = c.src === "run" ? (c.items[0]?.amount && /1 คน/.test(c.items[0].label) ? "Visa Run 边境签 (1人1车)" : "Visa Run 边境签")
    : c.src === "d90" ? "90天报到 90-day report"
    : EXT_ZH[c.office] ?? (c.items[0]?.label || "");   // jobs from /jobs keep the type · note as typed
  return [base, ...c.items.slice(1).map((i) => extraZh(i.label))].filter(Boolean).join(" + ");
}

export function buildStatement(days: DayLedger[], from: string, to: string): Statement {
  const span = days.filter((d) => d.day >= from && d.day <= to);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const openingDue = span.length ? r2(-span[0].carryIn) || 0 : 0;   // || 0: no "-0" when the book opens at zero
  let due = openingDue, fees = 0, received = 0;
  const rows: StatementRow[] = [];
  const push = (day: string, client: string, sub: string, service: string, fee: number, recv: number, kind: StatementRow["kind"]) => {
    due = r2(due + fee - recv); fees = r2(fees + fee); received = r2(received + recv);
    rows.push({ day, client, sub, service, fee, received: recv, due, kind });
  };
  for (const d of span) {
    for (const c of d.charges) push(d.day, c.cn || c.lf || c.name, c.cn ? (c.lf || c.name) : "", serviceZh(c), c.amount, c.paidDirect, "charge");
    for (const s of d.credits.filter((x) => x.kind === "slip")) push(d.day, "转账 Transfer", s.label, "", 0, s.amount, "payment");
    for (const a of d.adjustments) {
      if (a.amount > 0) push(d.day, "收款 Payment", "", a.label, 0, a.amount, "payment");
      else if (a.amount < 0) push(d.day, a.label || "其他费用 Other", "", "", -a.amount, 0, "extra");
    }
  }
  return { from, to, openingDue, rows, fees, received, due };
}

/** The statement as a table (header row first) — for Excel and for copy / paste. */
export function statementTable(agent: string, s: Statement): (string | number)[][] {
  const out: (string | number)[][] = [
    [`对账单 Statement · ${agent}`, `${dayTh(s.from)} – ${dayTh(s.to)}`],
    [],
    ["日期 Date", "客户 Client", "护照姓名 Passport name", "项目 Service", "费用 Fee", "已收 Received", "应付余额 Balance due"],
    ["", "上期结余 Previous balance", "", "", "", "", s.openingDue],
  ];
  for (const r of s.rows) out.push([dayTh(r.day), r.client, r.sub, r.service, r.fee || "", r.received || "", r.due]);
  out.push([]);
  out.push(["", "费用合计 Total fees", "", "", s.fees, "", ""]);
  out.push(["", "已收合计 Total received", "", "", "", s.received, ""]);
  out.push(["", s.due < 0 ? "预存余额 Credit balance (THB)" : "应付余额 Balance due (THB)", "", "", "", "", Math.abs(s.due)]);
  return out;
}
