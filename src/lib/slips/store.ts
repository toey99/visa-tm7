// =============================================================
// Transfer-slip room — Blob storage (server only)
// =============================================================
//   slips/<BOOK>/<YYYY-MM-DD>/<messageId>.json   one file per slip, under its accounting round
//   slips/<BOOK>/img/<YYYYMM>/<messageId>.<ext>  the picture
//   slips/<BOOK>/ref/<key>.json                  "this transfer was already filed" marker → { id, day }
//   slips/<BOOK>/state.json                      which rounds are closed
// Several slips forwarded at once arrive as parallel webhook calls; each one
// writes only its own files, so none can overwrite another. Not touched by
// the weekly purge (that only clears days/ and run/).
import { blobDeleteByPath, blobFetchUrl, blobGetJson, blobList, blobPut } from "@/lib/blob";
import { dedupeKey, type SlipBookId, type SlipItem, type SlipState } from "@/lib/slips/types";

const root = (book: SlipBookId) => `slips/${book}/`;
const itemPath = (book: SlipBookId, day: string, id: string) => `${root(book)}${day}/${id}.json`;
const refPath = (book: SlipBookId, key: string) => `${root(book)}ref/${key}.json`;
export const slipImgPath = (book: SlipBookId, yyyymm: string, id: string, ext: string) => `${root(book)}img/${yyyymm}/${id}.${ext}`;
export const safeSlipId = (id: unknown) => (typeof id === "string" && /^[A-Za-z0-9_-]{1,60}$/.test(id) ? id : null);
export const safeDay = (d: unknown) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);

export async function loadSlipState(book: SlipBookId): Promise<SlipState> {
  const s = await blobGetJson<SlipState>(`${root(book)}state.json`);
  return s && s.closed ? s : { closed: {} };
}
export async function saveSlipState(book: SlipBookId, s: SlipState): Promise<void> {
  // keep the last ~120 closings — older ones only matter to rounds long finished
  const keep = Object.entries(s.closed).sort(([a], [b]) => b.localeCompare(a)).slice(0, 120);
  await blobPut(`${root(book)}state.json`, JSON.stringify({ closed: Object.fromEntries(keep) }), "application/json");
}

export async function saveSlip(book: SlipBookId, item: SlipItem): Promise<void> {
  await blobPut(itemPath(book, item.day, item.id), JSON.stringify(item), "application/json");
}
export async function getSlip(book: SlipBookId, day: string, id: string): Promise<SlipItem | null> {
  return blobGetJson<SlipItem>(itemPath(book, day, id));
}
export async function listSlips(book: SlipBookId, day: string): Promise<SlipItem[]> {
  const blobs = (await blobList(`${root(book)}${day}/`)).filter((b) => b.pathname.endsWith(".json"));
  const items = await Promise.all(blobs.map(async (b) => {
    const r = await blobFetchUrl(b.url, true);
    return r.ok ? ((await r.json()) as SlipItem) : null;
  }));
  return items.filter((i): i is SlipItem => !!i && !!i.id).sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
}

/** Has this transfer been filed before? Returns the earlier slip, and claims the key for `item` when it is new. */
export async function claimTransfer(book: SlipBookId, item: SlipItem): Promise<{ id: string; day: string } | null> {
  const key = dedupeKey(item);
  if (!key) return null;
  const seen = await blobGetJson<{ id: string; day: string }>(refPath(book, key));
  if (seen && seen.id && seen.id !== item.id) return seen;
  await blobPut(refPath(book, key), JSON.stringify({ id: item.id, day: item.day }), "application/json");
  return null;
}
async function releaseTransfer(book: SlipBookId, item: SlipItem): Promise<void> {
  const key = dedupeKey(item);
  if (!key) return;
  const seen = await blobGetJson<{ id: string }>(refPath(book, key));
  if (seen?.id === item.id) await blobDeleteByPath([refPath(book, key)]).catch(() => undefined);
}

export async function moveSlip(book: SlipBookId, item: SlipItem, to: string): Promise<SlipItem> {
  if (to === item.day) return item;
  const next = { ...item, day: to };
  await saveSlip(book, next);
  await blobDeleteByPath([itemPath(book, item.day, item.id)]);
  const key = dedupeKey(item);
  if (key && !item.dupOf) await blobPut(refPath(book, key), JSON.stringify({ id: item.id, day: to }), "application/json");
  return next;
}
export async function deleteSlip(book: SlipBookId, item: SlipItem): Promise<void> {
  if (!item.dupOf) await releaseTransfer(book, item);
  await blobDeleteByPath([itemPath(book, item.day, item.id), item.img].filter(Boolean));
}
