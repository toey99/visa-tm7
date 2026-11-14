// =============================================================
// Transfer-slip room — shared types + pure helpers (client & server)
// =============================================================
// One LINE group per agency book (e.g. "สลิป อาเต่า"). Every bank-transfer
// slip forwarded there is read and filed under an ACCOUNTING ROUND (a day):
// the round stays open until it is closed by hand ("ตัดจบ" or a sticker in
// the group) — whatever arrives after that belongs to the next day's round,
// exactly how the daily closing note is written by hand.
//
// Keep this file free of "@/…" imports so it can be unit-tested with plain node.

export const SLIP_BOOKS = {
  ARTAO: { label: "อาเต่า" },
} as const;
export type SlipBookId = keyof typeof SLIP_BOOKS;
export const isSlipBook = (s: unknown): s is SlipBookId => typeof s === "string" && s in SLIP_BOOKS;

export type SlipItem = {
  id: string;            // LINE message id
  ts: number;            // when it was forwarded (ms)
  day: string;           // accounting round, YYYY-MM-DD
  img: string;           // blob pathname of the picture
  isSlip: boolean;       // false = the picture is not a transfer slip (kept, never counted)
  amount: number;        // THB
  paidDate: string;      // DD/MM/YYYY printed on the slip (Gregorian)
  paidTime: string;      // HH:MM
  sender: string;
  bank: string;          // sender's bank
  receiver: string;
  ref: string;           // the bank's transaction / reference number
  dupOf?: string;        // id of the slip this one repeats (same reference) — not counted
  excluded?: boolean;    // set by hand: keep the picture, leave it out of the total
  note?: string;
};
export type SlipState = { closed: Record<string, number> };   // round (YYYY-MM-DD) → when it was closed

const BKK = 7 * 3600 * 1000;
export const bkkDay = (ts: number) => new Date(ts + BKK).toISOString().slice(0, 10);
export const bkkTime = (ts: number) => new Date(ts + BKK).toISOString().slice(11, 16);
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** YYYY-MM-DD → 14/11/2026 */
export const dayTh = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
export const dayShort = (day: string) => `${Number(day.slice(8, 10))}/${Number(day.slice(5, 7))}`;

/** The round a slip arriving now belongs to: today, or the first day after it that is not closed yet. */
export function roundFor(state: SlipState, now: number): string {
  let d = bkkDay(now);
  for (let i = 0; i < 30 && state.closed[d]; i++) d = addDays(d, 1);
  return d;
}

/** "14/11", "14/11/2026", "14/11/69", "เมื่อวาน" → YYYY-MM-DD (Bangkok); "" when not a date */
export function parseDay(text: string, now: number): string {
  const t = text.trim();
  if (/^(เมื่อวาน|yesterday)$/i.test(t)) return addDays(bkkDay(now), -1);
  if (/^(วันนี้|today)$/i.test(t)) return bkkDay(now);
  const m = t.match(/^(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?$/);
  if (!m) return "";
  const dd = +m[1], mm = +m[2];
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return "";
  let y = Number(bkkDay(now).slice(0, 4));
  if (m[3]) { y = +m[3]; if (y < 100) y += y >= 43 ? 1957 : 2000; else if (y > 2400) y -= 543; }   // 69 → 2026 (พ.ศ. 2569)
  return `${y}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

export const counted = (i: SlipItem) => i.isSlip && !i.excluded && !i.dupOf && i.amount > 0;
export const money = (n: number) => (Math.round(n * 100) % 100 === 0 ? Math.round(n).toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const total = (items: SlipItem[]) => Math.round(items.filter(counted).reduce((s, i) => s + i.amount, 0) * 100) / 100;
export const byArrival = (items: SlipItem[]) => [...items].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));

/** "13,000+47,000+5,000 = 65,000" — the line as it is written in the daily closing note */
export function formula(items: SlipItem[]): string {
  const list = byArrival(items).filter(counted);
  if (!list.length) return "0";
  if (list.length === 1) return money(list[0].amount);
  return `${list.map((i) => money(i.amount)).join("+")} = ${money(total(list))}`;
}

export function summaryText(book: SlipBookId, day: string, items: SlipItem[], closedAt?: number): string {
  const list = byArrival(items);
  const ok = list.filter(counted);
  const head = `🧾 เงินโอน ${SLIP_BOOKS[book].label} · รอบ ${dayTh(day)} · ${ok.length} ใบ${closedAt ? " (ตัดจบแล้ว)" : ""}`;
  if (!list.length) return `${head}\nยังไม่มีสลิปในรอบนี้`;
  const rows = ok.map((i, k) => `${k + 1}. ${[i.paidDate ? `${i.paidDate.slice(0, 5)}` : "", i.paidTime].filter(Boolean).join(" ")} · ${money(i.amount)}${i.sender ? ` · ${i.sender}` : ""}`);
  const skipped = list.filter((i) => !counted(i));
  const tail = skipped.length ? `ไม่นับ ${skipped.length} รูป (ซ้ำ / ไม่ใช่สลิป / อ่านยอดไม่ได้ / ตัดออกเอง)` : "";
  return [head, rows.join("\n"), `เงินโอน\n${formula(list)}`, tail].filter(Boolean).join("\n\n");
}

/** A stable key for "the same transfer": the bank's reference, else amount + time + sender. "" = cannot tell. */
export function dedupeKey(i: Pick<SlipItem, "ref" | "amount" | "paidDate" | "paidTime" | "sender">): string {
  const ref = i.ref.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (ref.length >= 6) return `r-${ref.slice(0, 60)}`;
  if (i.amount > 0 && i.paidDate && i.paidTime) return `a-${Math.round(i.amount * 100)}-${i.paidDate.replace(/\D/g, "")}-${i.paidTime.replace(/\D/g, "")}`;
  return "";
}
