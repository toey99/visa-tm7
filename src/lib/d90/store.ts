// =============================================================
// 90-day report board — Blob storage (server only)
// =============================================================
//   d90/inbox/<messageId>.json   — one file per picture, written by the LINE webhook
//   d90/index.json               — every item, folded in from the inbox when the board is read
//   d90/img/YYYYMM/<messageId>.jpg
//   d90/config.json              — LINE groups the bot listens to
//
// Ten pictures forwarded at once arrive as parallel webhook calls. Each one
// only ever writes its OWN inbox file, so none can overwrite another; the
// shared index is touched only when someone opens the board (or the bot is
// asked a question). Not purged weekly — a case must survive until its slip
// returns, and the next-report date is kept for the reminder. Items older
// than KEEP_DAYS are dropped together with their pictures.

import { blobDelete, blobDeleteByPath, blobFetchUrl, blobGetByPath, blobList, blobPut } from "@/lib/blob";
import type { D90Group, D90Item } from "@/lib/d90/types";

const INDEX = "d90/index.json";
const CONFIG = "d90/config.json";
const INBOX = "d90/inbox/";
const KEEP_DAYS = 400;

type Index = { items: D90Item[] };
export type D90Config = { groups: Record<string, D90Group> };

/** null only when the file truly doesn't exist — a failed read must never look like "empty" */
async function readJson<T>(path: string): Promise<T | null> {
  const r = await blobGetByPath(path, true);
  if (!r) return null;
  if (!r.ok) throw new Error(`Blob read failed (${r.status}) for ${path}`);
  return (await r.json()) as T;
}

export async function saveInboxItem(item: D90Item): Promise<void> {
  await blobPut(`${INBOX}${item.id}.json`, JSON.stringify(item), "application/json");
}

/** Read every item, folding newly arrived inbox files into the index. */
export async function loadItems(): Promise<D90Item[]> {
  const idx = (await readJson<Index>(INDEX)) ?? { items: [] };
  const inbox = (await blobList(INBOX)).filter((b) => b.pathname.endsWith(".json"));
  const have = new Set(idx.items.map((i) => i.id));
  const fresh: D90Item[] = [];
  const folded: string[] = [];
  await Promise.all(inbox.map(async (b) => {
    const r = await blobFetchUrl(b.url, true);
    if (!r.ok) return; // leave it in the inbox for the next read
    const it = (await r.json()) as D90Item;
    folded.push(b.url);
    if (it && it.id && !have.has(it.id)) { have.add(it.id); fresh.push(it); }
  }));

  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  const old = idx.items.filter((i) => i.ts < cutoff);
  const items = [...idx.items.filter((i) => i.ts >= cutoff), ...fresh].sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));

  if (fresh.length || old.length) {
    await blobPut(INDEX, JSON.stringify({ items }), "application/json");
    if (old.length) await blobDeleteByPath(old.map((i) => i.img).filter(Boolean)).catch(() => undefined);
  }
  // only after the index is safely written
  if (folded.length) await blobDelete(folded).catch(() => undefined);
  return items;
}

/** Apply a change to the index (after folding the inbox in) and save it. */
export async function mutateItems(fn: (items: D90Item[]) => D90Item[]): Promise<D90Item[]> {
  const items = fn(await loadItems());
  await blobPut(INDEX, JSON.stringify({ items }), "application/json");
  return items;
}

// ---- groups ----------------------------------------------------------------
let cfgCache: { at: number; cfg: D90Config } | null = null;

export async function loadConfig(fresh = false): Promise<D90Config> {
  if (!fresh && cfgCache && Date.now() - cfgCache.at < 20_000) return cfgCache.cfg;
  const cfg = (await readJson<D90Config>(CONFIG)) ?? { groups: {} };
  if (!cfg.groups) cfg.groups = {};
  cfgCache = { at: Date.now(), cfg };
  return cfg;
}

export async function saveConfig(cfg: D90Config): Promise<void> {
  await blobPut(CONFIG, JSON.stringify(cfg), "application/json");
  cfgCache = { at: Date.now(), cfg };
}
