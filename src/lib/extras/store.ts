// =============================================================
// Off-board work ("งานนอกบอร์ด")
// =============================================================
// Jobs that never went through a day board or the long-stay job list — e.g.
// a few returning customers served directly — entered as one lump line so the
// dashboard still counts their people, sale, cost and counter money.
// One monthly file (extras/YYYY-MM.json) keyed by the work day; kept for good.
import { blobGetJson, blobPut } from "@/lib/blob";

export type Extra = {
  id: string;
  day: string;              // YYYY-MM-DD — counts on this day
  label: string;            // what it was, e.g. "ค่าบริการ VFS ลูกค้าเก่า"
  people: number;
  sale: number;             // total charged
  cost: number;             // total cost (sale − profit)
  how: "cash" | "transfer" | "none";   // how the money came in ("none" = not counter money)
  agent: string;            // dashboard group, "ลูกค้าตรง" by default
  createdAt: string;
  updatedAt: string;
};

const monthOf = (day: string) => day.slice(0, 7);
const pathOf = (month: string) => `extras/${month}.json`;

export async function listExtras(month: string): Promise<Extra[]> {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  return (await blobGetJson<Extra[]>(pathOf(month))) ?? [];
}

/** Off-board lines whose day falls in [from, to]. */
export async function extrasInRange(from: string, to: string): Promise<Extra[]> {
  const months = new Set<string>();
  for (let m = monthOf(from); m <= monthOf(to); ) {
    months.add(m);
    const [y, mm] = m.split("-").map(Number);
    m = `${mm === 12 ? y + 1 : y}-${String(mm === 12 ? 1 : mm + 1).padStart(2, "0")}`;
    if (months.size > 36) break;
  }
  const all = (await Promise.all([...months].map(listExtras))).flat();
  return all.filter((x) => x.day >= from && x.day <= to).sort((a, b) => (a.day === b.day ? a.createdAt.localeCompare(b.createdAt) : a.day.localeCompare(b.day)));
}

export async function saveExtra(x: Extra): Promise<Extra> {
  const month = monthOf(x.day);
  const list = await listExtras(month);
  const now = new Date().toISOString();
  const next = { ...x, updatedAt: now, createdAt: x.createdAt || now };
  const i = list.findIndex((e) => e.id === x.id);
  if (i >= 0) list[i] = next; else list.push(next);
  await blobPut(pathOf(month), JSON.stringify(list), "application/json");
  return next;
}

export async function removeExtra(month: string, id: string): Promise<void> {
  const list = await listExtras(month);
  const left = list.filter((e) => e.id !== id);
  if (left.length !== list.length) await blobPut(pathOf(month), JSON.stringify(left), "application/json");
}
