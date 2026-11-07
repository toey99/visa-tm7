// Server-backed persistence for the /today board (client side).
//
// Everything lives in the project's Vercel Blob store, so both signed-in
// users see the same day from any device, and the week's days can be
// reopened until the Sunday-night purge. Binaries are uploaded once and
// referenced by path in the day's index.json; the index is saved (debounced)
// after every change. Blobs are cached in memory per session.

import type { DayMeta, DocFile, Person } from "./types";

type FileRef = Omit<DocFile, "blob"> & { path: string };
type PersonRef = Omit<Person, "files" | "tm7Pdf" | "aiPhoto" | "photo" | "collectImage"> & {
  files: FileRef[];
  tm7Pdf?: string;
  aiPhoto?: string;
  photo?: string;
  collectImage?: string;
};
type DayIndex = { meta?: DayMeta; people: PersonRef[]; savedAt: string };

const dayKeyOf = (date: string) => date.replace(/\//g, "");

// ---------- in-memory state for the open day ----------
let currentDay = "";
let peopleCache = new Map<string, Person>();
let metaCache: DayMeta | null = null;
let saveTimer: number | undefined;
let savingPromise: Promise<void> | null = null;
export let lastError = "";
export let lastSavedAt = 0;
let loading = false;
let loadToken = 0;
export let loadProgress = "";
export function isLoading() { return loading; }

function extOf(mime: string) {
  return mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : "jpg";
}

async function uploadBlob(path: string, blob: Blob): Promise<string> {
  const fd = new FormData();
  fd.append("path", path);
  fd.append("file", new File([blob], path.split("/").pop() ?? "file", { type: blob.type || "application/octet-stream" }));
  const r = await fetch("/api/day/file", { method: "POST", body: fd });
  if (!r.ok) throw new Error((await r.json().catch(() => ({ error: `HTTP ${r.status}` }))).error);
  return ((await r.json()) as { path: string }).path;
}

async function downloadBlob(path: string): Promise<Blob | null> {
  const r = await fetch(`/api/day/file?path=${encodeURIComponent(path)}`);
  if (!r.ok) return null;
  return r.blob();
}

// Paths already uploaded, keyed by object identity (a Blob is re-uploaded only if it's a new object).
const uploaded = new WeakMap<Blob, string>();

async function ensureUploaded(day: string, personId: string, name: string, blob: Blob | undefined): Promise<string | undefined> {
  if (!blob) return undefined;
  const known = uploaded.get(blob);
  if (known) return known;
  const path = await uploadBlob(`days/${day}/${personId}/${name}.${extOf(blob.type)}`, blob);
  uploaded.set(blob, path);
  return path;
}

async function toRef(day: string, p: Person): Promise<PersonRef> {
  const files: FileRef[] = [];
  for (const f of p.files) {
    const { blob, ...rest } = f;
    const path = (await ensureUploaded(day, p.id, `doc-${f.id}`, blob)) ?? "";
    files.push({ ...rest, path });
  }
  const { files: _f, tm7Pdf, aiPhoto, photo, collectImage, ...rest } = p;
  void _f;
  return {
    ...rest,
    files,
    tm7Pdf: await ensureUploaded(day, p.id, "tm7", tm7Pdf),
    aiPhoto: await ensureUploaded(day, p.id, "ai-photo", aiPhoto),
    photo: await ensureUploaded(day, p.id, "photo-white", photo),
    collectImage: await ensureUploaded(day, p.id, "collect", collectImage),
  };
}

async function fromRef(r: PersonRef, onOne?: () => void): Promise<Person> {
  const files = await Promise.all(r.files.map(async (f) => {
    const blob = f.path ? await downloadBlob(f.path) : null;
    onOne?.();
    const { path, ...rest } = f;
    const b = blob ?? new Blob([], { type: rest.mime });
    if (path) uploaded.set(b, path);
    return { ...rest, blob: b } as DocFile;
  }));
  const pick = async (path?: string) => {
    if (!path) return undefined;
    const b = await downloadBlob(path);
    onOne?.();
    if (b) uploaded.set(b, path);
    return b ?? undefined;
  };
  const { files: _f, tm7Pdf, aiPhoto, photo, collectImage, ...rest } = r;
  void _f;
  const [a, b2, c, d] = await Promise.all([pick(tm7Pdf), pick(aiPhoto), pick(photo), pick(collectImage)]);
  return { ...rest, files, tm7Pdf: a, aiPhoto: b2, photo: c, collectImage: d };
}

// ---------- public API (same shape the page used with IndexedDB) ----------

export async function loadDay(date: string): Promise<{ people: Person[]; meta: DayMeta | null; stale?: boolean }> {
  const day = dayKeyOf(date);
  const token = ++loadToken;
  if (saveTimer) { window.clearTimeout(saveTimer); saveTimer = undefined; }
  loading = true;
  currentDay = day;
  peopleCache = new Map();
  metaCache = null;
  lastError = "";
  loadProgress = "";
  try {
    const r = await fetch(`/api/day?date=${day}`, { cache: "no-store" });
    if (!r.ok) throw new Error((await r.json().catch(() => ({ error: `HTTP ${r.status}` }))).error);
    const idx = (await r.json()) as Partial<DayIndex>;
    const refs = idx.people ?? [];
    const total = refs.reduce((n, p) => n + p.files.length + [p.tm7Pdf, p.aiPhoto, p.photo, p.collectImage].filter(Boolean).length, 0);
    let done = 0;
    const tick = () => { done++; loadProgress = `${done}/${total} ไฟล์`; };
    const people = await Promise.all(refs.map((ref) => fromRef(ref, tick)));
    if (token !== loadToken) return { people: [], meta: null, stale: true }; // a newer load took over
    people.sort((a, b) => a.order - b.order);
    for (const p of people) peopleCache.set(p.id, p);
    metaCache = idx.meta ?? null;
    return { people, meta: metaCache };
  } catch (e) {
    if (token !== loadToken) return { people: [], meta: null, stale: true };
    lastError = e instanceof Error ? e.message : String(e);
    return { people: [], meta: null };
  } finally {
    if (token === loadToken) { loading = false; loadProgress = ""; }
  }
}

function scheduleSave() {
  if (loading) return; // a load is in progress — saving now would write an empty day
  if (saveTimer) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { saveTimer = undefined; void flush(); }, 800);
}

export async function flush(): Promise<void> {
  if (savingPromise) await savingPromise;
  const day = currentDay;
  if (!day || loading) return;
  savingPromise = (async () => {
    try {
      const refs: PersonRef[] = [];
      for (const p of peopleCache.values()) refs.push(await toRef(day, p));
      refs.sort((a, b) => a.order - b.order);
      const idx: DayIndex = { meta: metaCache ?? undefined, people: refs, savedAt: new Date().toISOString() };
      const r = await fetch(`/api/day?date=${day}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(idx) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({ error: `HTTP ${r.status}` }))).error);
      lastError = "";
      lastSavedAt = Date.now();
    } catch (e) {
      lastError = "บันทึกไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e));
      console.warn("[today/store] save failed", e);
    } finally {
      savingPromise = null;
    }
  })();
  await savingPromise;
}

export async function savePerson(p: Person): Promise<void> {
  peopleCache.set(p.id, p);
  scheduleSave();
}

export async function deletePerson(id: string): Promise<void> {
  peopleCache.delete(id);
  scheduleSave();
}

export async function saveMeta(meta: DayMeta): Promise<void> {
  const day = dayKeyOf(meta.date);
  if (day !== currentDay) return; // date change is handled by loadDay
  metaCache = meta;
  scheduleSave();
}

export async function clearDay(date: string): Promise<void> {
  const day = dayKeyOf(date);
  if (saveTimer) window.clearTimeout(saveTimer);
  peopleCache = new Map();
  metaCache = null;
  await fetch(`/api/day?date=${day}`, { method: "DELETE" });
}

export async function listDays(): Promise<{ date: string; files: number; updated: string }[]> {
  try {
    const r = await fetch("/api/day/list", { cache: "no-store" });
    if (!r.ok) return [];
    return ((await r.json()) as { days: { date: string; files: number; updated: string }[] }).days;
  } catch {
    return [];
  }
}

export function isSaving(): boolean {
  return !!savingPromise || !!saveTimer;
}
