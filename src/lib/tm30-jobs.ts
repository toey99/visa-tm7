// =============================================================
// TM.30 bot jobs — a small queue between the day board and the
// "TM30 Bot" Chrome extension (server only)
// =============================================================
// The board (phone or PC) queues a batch: the TM.30 upload Excel plus who is
// in it. The extension runs in Chrome on the home PC, in a tab the user has
// signed in to the immigration TM.30 site themselves; it polls this queue,
// uploads the Excel there, reports back what the site read ("review"), and
// waits. Only after someone presses confirm on the board does it save on the
// TM.30 site, download each person's receipt PDF and post it back here, where
// it is filed onto that person's card exactly like a receipt dropped by hand.
//
// Storage: tm30jobs/queue.json   { jobs: [...], botSeenAt }  (read by path — no list())
//          tm30jobs/<jobId>.xls  the Excel for the extension to upload
// Jobs older than 3 days are dropped on the next write.
import { blobDeleteByPath, blobGetJson, blobPut } from "@/lib/blob";
import { analyzeTm30 } from "@/app/actions/analyzeTm30";
import { boardFolder, recPath, safeId, saveToBoard, type PersonRec } from "@/lib/day-server";

export type Tm30JobStatus = "queued" | "working" | "review" | "confirmed" | "saving" | "downloading" | "done" | "error" | "cancelled";
export type Tm30JobPerson = { id: string; passportNo: string; name: string };
export type Tm30Address = { houseNo: string; road: string; subDistrict: string; district: string; province: string; postalCode: string };
export type Tm30Job = {
  id: string;
  createdAt: string;
  updatedAt: string;
  ns: "days" | "run" | "d90";  // d90 = a list from the 90-day board: people are board items, receipts are kept with the job
  day: string;                 // DDMMYYYY
  office: string;              // OfficeId ("D90" for the 90-day board)
  label: string;               // shown on the board and in the extension, e.g. "IT 14/11/2026 ชุด1"
  people: Tm30JobPerson[];
  status: Tm30JobStatus;
  message?: string;
  preview?: string[];          // passport numbers the TM.30 site read from the Excel
  done?: string[];             // passport numbers whose receipt is filed on the board
  address?: Tm30Address;       // read once from the first receipt — one import = one address
};
export type Tm30Queue = { jobs: Tm30Job[]; botSeenAt?: string };

const QUEUE = "tm30jobs/queue.json";
const KEEP_MS = 3 * 86400 * 1000;
const MAX_JOBS = 60;
export const xlsPath = (id: string) => `tm30jobs/${id}.xls`;
/** d90 jobs only: where one person's receipt is kept until the job is purged */
export const receiptPath = (id: string, passport: string) => `tm30jobs/${id}/${passport}.pdf`;
export const ACTIVE: Tm30JobStatus[] = ["queued", "working", "review", "confirmed", "saving", "downloading"];
export const cleanPassport = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);

export async function readQueue(): Promise<Tm30Queue> {
  const q = await blobGetJson<Tm30Queue>(QUEUE);
  return q && Array.isArray(q.jobs) ? q : { jobs: [] };
}

async function writeQueue(q: Tm30Queue): Promise<void> {
  const cutoff = Date.now() - KEEP_MS;
  const sorted = [...q.jobs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const keep = sorted.filter((j) => new Date(j.createdAt).getTime() >= cutoff).slice(-MAX_JOBS);
  const gone = sorted.filter((j) => !keep.includes(j));
  await blobPut(QUEUE, JSON.stringify({ ...q, jobs: keep }), "application/json");
  if (gone.length) await blobDeleteByPath(gone.flatMap((j) => [xlsPath(j.id), ...(j.ns === "d90" ? (j.done ?? []).map((p) => receiptPath(j.id, p)) : [])])).catch(() => undefined);
}

/** Read–change–write one job. Returns the job as stored, or null when it does not exist. */
export async function updateJob(id: string, change: (j: Tm30Job) => void): Promise<Tm30Job | null> {
  const q = await readQueue();
  const j = q.jobs.find((x) => x.id === id);
  if (!j) return null;
  change(j);
  j.updatedAt = new Date().toISOString();
  await writeQueue(q);
  return j;
}

export async function createJob(input: Pick<Tm30Job, "ns" | "day" | "office" | "label" | "people">, xls: ArrayBuffer): Promise<Tm30Job> {
  const now = new Date().toISOString();
  const id = `j${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  await blobPut(xlsPath(id), xls, "application/vnd.ms-excel");
  const job: Tm30Job = { ...input, id, createdAt: now, updatedAt: now, status: "queued", done: [] };
  const q = await readQueue();
  q.jobs.push(job);
  await writeQueue(q);
  return job;
}

/** The extension says it is alive; written at most every 5 minutes to keep Blob writes low. */
export async function botSeen(q: Tm30Queue): Promise<void> {
  const last = q.botSeenAt ? new Date(q.botSeenAt).getTime() : 0;
  if (Date.now() - last < 5 * 60 * 1000) return;
  const fresh = await readQueue();
  fresh.botSeenAt = new Date().toISOString();
  await writeQueue(fresh);
}

// What each side may set. The board decides confirm/cancel; the extension
// reports progress. Nothing moves a finished or cancelled job again.
const BOARD_SET: Tm30JobStatus[] = ["confirmed", "cancelled"];
const BOT_SET: Tm30JobStatus[] = ["working", "review", "saving", "downloading", "done", "error"];
export function canSet(job: Tm30Job, next: Tm30JobStatus, who: "board" | "bot"): boolean {
  if (job.status === "done" || job.status === "cancelled") return false;
  if (who === "board") {
    if (!BOARD_SET.includes(next)) return false;
    return next === "cancelled" ? true : job.status === "review";
  }
  if (!BOT_SET.includes(next)) return false;
  if (next === "saving") return job.status === "confirmed";   // never save on the TM.30 site without the board's confirm
  if (next === "working") return job.status === "queued" || job.status === "error";
  return true;
}

type FileRef = { id: string; kind?: string; mime?: string; [k: string]: unknown };

/** File one receipt PDF from the extension onto the person's card (and fill the address like a hand-dropped receipt). */
export async function fileReceipt(jobId: string, passportRaw: string, pdf: ArrayBuffer): Promise<{ ok: true; skipped?: boolean; name: string } | { ok: false; status: number; error: string }> {
  const passport = cleanPassport(passportRaw);
  const head = new Uint8Array(pdf.slice(0, 4));
  if (!(head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46)) return { ok: false, status: 400, error: "not a PDF" };
  const q = await readQueue();
  const job = q.jobs.find((x) => x.id === jobId);
  if (!job) return { ok: false, status: 404, error: "job not found" };
  if (job.status === "cancelled") return { ok: false, status: 409, error: "job cancelled" };
  const who = job.people.find((p) => cleanPassport(p.passportNo) === passport);
  const personId = who ? safeId(who.id) : null;
  if (!who || !personId) return { ok: false, status: 404, error: `passport ${passport} is not in this job` };

  // 90-day list: no day-board card to file onto — keep the receipt with the job
  // (the board offers them back as one merged PDF to pass on to the officer)
  if (job.ns === "d90") {
    await blobPut(receiptPath(jobId, passport), pdf, "application/pdf");
    await updateJob(jobId, (j) => { j.done = Array.from(new Set([...(j.done ?? []), passport])); });
    return { ok: true, name: who.name };
  }

  const folder = boardFolder(job.ns, job.day, job.office);
  const cur = await blobGetJson<PersonRec>(recPath(folder, personId));
  if (!cur || cur.tombstone) return { ok: false, status: 404, error: `${who.name} is no longer on the board` };

  const files = ((cur.files as FileRef[] | undefined) ?? []).slice();
  const fileId = `tm30bot-${passport}`;
  const hasOther = files.some((f) => f.kind === "tm30" && f.mime === "application/pdf" && f.id !== fileId);
  let address = job.address;
  if (!hasOther) {
    const dest = `${folder}${personId}/doc-${fileId}.pdf`;
    await blobPut(dest, pdf, "application/pdf");
    const ref: FileRef = { id: fileId, kind: "tm30", name: `TM30 ${who.name || passport}.pdf`, mime: "application/pdf", status: "done", path: dest };
    const at = files.findIndex((f) => f.id === fileId);
    if (at >= 0) files[at] = ref; else files.push(ref);

    if (!address) {
      try {
        const fd = new FormData();
        fd.set("document", new File([pdf], "tm30.pdf", { type: "application/pdf" }));
        const r = await analyzeTm30(fd);
        if (r.ok) address = { houseNo: r.data.houseNo, road: r.data.road, subDistrict: r.data.subDistrict, district: r.data.district, province: r.data.province, postalCode: r.data.postalCode };
      } catch { /* the receipt is still filed; the address can be typed on the card */ }
    }
    const f = { ...((cur.fields as Record<string, unknown> | undefined) ?? {}) };
    if (address) for (const [k, v] of Object.entries(address)) if (v) f[k] = v;
    const next: PersonRec = { ...cur, fields: f, files };
    await saveToBoard(job.ns, job.day, job.office, folder, { v: 2, people: [next], bases: { [personId]: cur } });
  }

  await updateJob(jobId, (j) => {
    j.done = Array.from(new Set([...(j.done ?? []), passport]));
    if (address && !j.address) j.address = address;
  });
  return { ok: true, skipped: hasOther || undefined, name: who.name };
}
