// =============================================================
// Long-stay visa jobs (Non-O, Non-B, Non-ED, retirement, DTV …)
// =============================================================
// Work that is not a same-day counter job: it is applied for on one day,
// decided weeks later, and priced per case. One record per job, kept in a
// monthly file (jobs/YYYY-MM.json) keyed by the application date, so the
// dashboard and the agent ledger can count its sale and cost on that day.
import { blobGetJson, blobPut } from "@/lib/blob";

export const JOB_TYPES = [
  "Non-O ติดตามบุตร (เรียนในไทย)",
  "Non-O คู่สมรสไทย",
  "Non-O เกษียณ (Retirement)",
  "Non-O ผู้ปกครอง",
  "Non-B ทำงาน",
  "Non-ED เรียน",
  "DTV",
  "เปลี่ยนประเภทวีซ่า (TM.86)",
  "ขอรับการตรวจลงตรา (TM.87)",
  "ต่ออายุ 1 ปี",
  "Re-entry",
  "ใบอนุญาตทำงาน",
  "อื่น ๆ",
] as const;

export const JOB_STATUS = ["ยื่นแล้ว", "รอพิจารณา", "รับเล่มแล้ว", "ไม่ผ่าน", "ยกเลิก"] as const;

export type Job = {
  id: string;
  day: string;              // YYYY-MM-DD — application / work date (counts on this day)
  type: string;
  customer: string;         // name as on passport
  cn?: string;
  passportNo?: string;
  nationality?: string;
  agent: string;            // main agent or "ลูกค้าตรง"
  office?: string;          // where it is filed
  sale: number;             // what we charge
  cost: number;             // official fees + partner + extras, all in
  costNote?: string;        // e.g. "ค่าธรรมเนียม 2,000 + ล่าม 1,000"
  status: typeof JOB_STATUS[number];
  dueDay?: string;          // YYYY-MM-DD — result / pick-up date
  note?: string;
  paid?: "pending" | "paid" | "agent";
  createdAt: string;
  updatedAt: string;
};

const monthOf = (day: string) => day.slice(0, 7);
const pathOf = (month: string) => `jobs/${month}.json`;

export async function listJobs(month: string): Promise<Job[]> {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  return (await blobGetJson<Job[]>(pathOf(month))) ?? [];
}

/** Jobs whose work day falls in [from, to]. */
export async function jobsInRange(from: string, to: string): Promise<Job[]> {
  const months = new Set<string>();
  for (let m = monthOf(from); m <= monthOf(to); ) {
    months.add(m);
    const [y, mm] = m.split("-").map(Number);
    m = `${mm === 12 ? y + 1 : y}-${String(mm === 12 ? 1 : mm + 1).padStart(2, "0")}`;
    if (months.size > 36) break;
  }
  const all = (await Promise.all([...months].map(listJobs))).flat();
  return all.filter((j) => j.day >= from && j.day <= to);
}

export async function saveJob(job: Job): Promise<Job> {
  const month = monthOf(job.day);
  const jobs = await listJobs(month);
  const now = new Date().toISOString();
  const next = { ...job, updatedAt: now, createdAt: job.createdAt || now };
  const i = jobs.findIndex((j) => j.id === job.id);
  if (i >= 0) jobs[i] = next; else jobs.push(next);
  await blobPut(pathOf(month), JSON.stringify(jobs), "application/json");
  return next;
}

/** Move between months when the day changes: remove from the old month file first. */
export async function removeJob(month: string, id: string): Promise<void> {
  const jobs = await listJobs(month);
  const left = jobs.filter((j) => j.id !== id);
  if (left.length !== jobs.length) await blobPut(pathOf(month), JSON.stringify(left), "application/json");
}
