// Server-backed persistence for the /today and /visarun boards (client side).
//
// Everything lives in the project's Vercel Blob store, so both signed-in
// users see the same day from any device, and the week's days can be
// reopened until the Sunday-night purge. Binaries are uploaded once and
// referenced by path; the server keeps ONE RECORD PER PERSON and a save is a
// merge: it only touches the people it carries (newest updatedAt wins) and
// removes someone only when told to (`deleted`). Two devices on the same
// board therefore never wipe each other's customers. Blobs are cached in
// memory per session; refreshFromServer() pulls in what the other device
// added.
//
// Each board has its own namespace on the server ("days/" for the extension
// board, "run/" for the visa-run board), so the two never see each other's
// customers even on the same date. Inside a day, each immigration office has
// its own folder (days/<DDMMYYYY>/<OfficeId>/), so IT Square and Nonthaburi on
// the same date are separate boards too; loadDay(date, office) picks one. createDayStore(ns) builds one store per
// namespace; the named exports below are the extension board's store.

import type { DayMeta, DocFile, Person } from "./types";

type FileRef = Omit<DocFile, "blob"> & { path: string };
export type PersonRef = Omit<Person, "files" | "tm7Pdf" | "aiPhoto" | "photo" | "collectImage"> & {
  files: FileRef[];
  tm7Pdf?: string;
  aiPhoto?: string;
  photo?: string;
  collectImage?: string;
};
type DayIndex = { meta?: DayMeta; people: PersonRef[]; savedAt: string; deleted?: string[]; known?: string[] };
type Manifest = { meta?: DayMeta; savedAt: string; entries: Record<string, { updatedAt: string; order: number }> };

const dayKeyOf = (date: string) => date.replace(/\//g, "");

export type DayNamespace = "days" | "run";

export function createDayStore(ns: DayNamespace) {
  // ---------- in-memory state for the open day ----------
  let currentDay = "";
  let currentOffice = "";   // OfficeId — each office keeps its own folder inside the day
  const q = (day: string, office = currentOffice) => `ns=${ns}&date=${day}${office ? `&office=${office}` : ""}`;
  const folder = (day: string, office = currentOffice) => `${ns}/${day}/${office ? `${office}/` : ""}`;
  let peopleCache = new Map<string, Person>();
  let metaCache: DayMeta | null = null;
  // UI listeners: told whenever the server changed what this board holds
  // (merged save results, another device's edits) so React state follows the cache
  const listeners = new Set<(s: { people: Person[]; meta: DayMeta | null }) => void>();
  function subscribe(fn: (s: { people: Person[]; meta: DayMeta | null }) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
  function notify() { const snap = { people: [...peopleCache.values()].sort((a, b) => a.order - b.order), meta: metaCache }; for (const fn of listeners) fn(snap); }
  let dirty = new Set<string>();        // people changed here and not yet saved
  let deletedIds = new Set<string>();   // people removed here and not yet told to the server
  let metaDirty = false;                // day settings changed here and not yet saved
  const now = () => new Date().toISOString();
  let saveTimer: number | undefined;
  let savingPromise: Promise<void> | null = null;
  let saveRun: object | null = null;
  let lastError = "";
  let lastSavedAt = 0;
  let loading = false;
  let loadToken = 0;
  let loadProgress = "";
  function isLoading() { return loading; }

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

  // MIME from the file extension — the store may hand a file back as
  // application/octet-stream, and an <img> shows that fine on screen, but the
  // PNG exporter (html-to-image) turns images into data: URLs and the browser
  // refuses to draw a data:application/octet-stream image → blank photos in
  // exported sheets. Always give downloaded blobs a real type.
  function mimeOf(path: string, fallback: string): string {
    const ext = (path.split(".").pop() ?? "").toLowerCase();
    return ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : fallback;
  }
  async function downloadBlob(path: string): Promise<Blob | null> {
    const r = await fetch(`/api/day/file?path=${encodeURIComponent(path)}`);
    if (!r.ok) return null;
    const raw = await r.blob();
    const type = raw.type && raw.type !== "application/octet-stream" ? raw.type : mimeOf(path, "image/jpeg");
    return raw.type === type ? raw : new Blob([raw], { type });
  }

  // Paths already uploaded, keyed by object identity (a Blob is re-uploaded only if it's a new object).
  const uploaded = new WeakMap<Blob, string>();
  // Failed downloads are kept as empty placeholder blobs so the person still
  // shows; they are remembered here so a later forced copy (move / import)
  // never uploads the empty blob over the real file.
  const missing = new WeakSet<Blob>();

  async function ensureUploaded(day: string, personId: string, name: string, blob: Blob | undefined, force = false, office = currentOffice): Promise<string | undefined> {
    if (!blob) return undefined;
    const known = uploaded.get(blob);
    if (missing.has(blob)) return known;                      // download failed earlier: keep pointing at the original file
    if (known && !force && known.startsWith(folder(day, office))) return known;
    const path = await uploadBlob(`${folder(day, office)}${personId}/${name}.${extOf(blob.type)}`, blob);
    uploaded.set(blob, path);
    return path;
  }

  async function toRef(day: string, p: Person, force = false, office = currentOffice): Promise<PersonRef> {
    const files: FileRef[] = [];
    for (const f of p.files) {
      const { blob, ...rest } = f;
      const path = (await ensureUploaded(day, p.id, `doc-${f.id}`, blob, force, office)) ?? "";
      files.push({ ...rest, path });
    }
    const { files: _f, tm7Pdf, aiPhoto, photo, collectImage, ...rest } = p;
    void _f;
    return {
      ...rest,
      files,
      tm7Pdf: await ensureUploaded(day, p.id, "tm7", tm7Pdf, force, office),
      aiPhoto: await ensureUploaded(day, p.id, "ai-photo", aiPhoto, force, office),
      photo: await ensureUploaded(day, p.id, "photo-white", photo, force, office),
      collectImage: await ensureUploaded(day, p.id, "collect", collectImage, force, office),
    };
  }

  // at most 6 downloads in flight: a 40-person day opened on two phones at
  // once otherwise trips the store's per-second read limit → 429s → blanks
  let inFlight = 0;
  const waiters: (() => void)[] = [];
  async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
    if (inFlight >= 6) await new Promise<void>((res) => waiters.push(res));
    inFlight++;
    try { return await fn(); } finally { inFlight--; waiters.shift()?.(); }
  }
  async function downloadBlobRetry(path: string): Promise<Blob | null> {
    return withSlot(async () => {
      const b = await downloadBlob(path);
      if (b) return b;
      await new Promise((r) => setTimeout(r, 700));
      return downloadBlob(path);
    });
  }

  async function fromRef(r: PersonRef, onOne?: () => void): Promise<Person> {
    const files = await Promise.all(r.files.map(async (f) => {
      const blob = f.path ? await downloadBlobRetry(f.path) : null;
      onOne?.();
      const { path, ...rest } = f;
      const b = blob ?? new Blob([], { type: rest.mime });
      if (path) uploaded.set(b, path);
      if (!blob) missing.add(b);
      return { ...rest, blob: b } as DocFile;
    }));
    const pick = async (path?: string) => {
      if (!path) return undefined;
      const b = await downloadBlobRetry(path);
      onOne?.();
      if (b) uploaded.set(b, path);
      return b ?? undefined;
    };
    const { files: _f, tm7Pdf, aiPhoto, photo, collectImage, ...rest } = r;
    void _f;
    const [a, b2, c, d] = await Promise.all([pick(tm7Pdf), pick(aiPhoto), pick(photo), pick(collectImage)]);
    return { ...rest, files, tm7Pdf: a, aiPhoto: b2, photo: c, collectImage: d };
  }

  // The record of each person as the server last gave it to us — the "base"
  // every edit is measured against when the server merges two devices' changes.
  let bases = new Map<string, PersonRef>();
  let metaAt = "";   // server version of the day settings we loaded
  const stripBlobs = (r: PersonRef): PersonRef => JSON.parse(JSON.stringify(r)) as PersonRef;

  // Apply a record the server handed back after a save: if another device had
  // changed this person meanwhile, the server merged the two and this is the
  // result. Files that differ from ours are downloaded; otherwise just the
  // fields/flags are taken over. Skipped when the person was edited here again.
  async function applyServerRecord(rec: PersonRef, sentObj: Person | undefined): Promise<boolean> {
    const local = peopleCache.get(rec.id);
    if (!local || (sentObj && local !== sentObj)) return false;     // edited again since — keep ours, it will be saved next
    bases.set(rec.id, stripBlobs(rec));
    const sameFiles = JSON.stringify(rec.files.map((f) => f.path)) === JSON.stringify(local.files.map((f) => uploaded.get(f.blob) ?? "")) &&
      [rec.tm7Pdf, rec.aiPhoto, rec.photo, rec.collectImage].join("|") === [local.tm7Pdf, local.aiPhoto, local.photo, local.collectImage].map((b) => (b ? uploaded.get(b) ?? "" : "")).join("|");
    if (sameFiles) {
      const { files: _f, tm7Pdf: _t, aiPhoto: _a, photo: _p, collectImage: _c, ...rest } = rec;
      void _f; void _t; void _a; void _p; void _c;
      peopleCache.set(rec.id, { ...local, ...rest, files: local.files, tm7Pdf: local.tm7Pdf, aiPhoto: local.aiPhoto, photo: local.photo, collectImage: local.collectImage });
    } else {
      const p = await fromRef(rec);
      if (peopleCache.get(rec.id) !== local) return false;
      peopleCache.set(rec.id, p);
    }
    return true;
  }

  // ---------- public API (same shape the page used with IndexedDB) ----------

  async function loadDay(date: string, office = ""): Promise<{ people: Person[]; meta: DayMeta | null; stale?: boolean }> {
    const day = dayKeyOf(date);
    const token = ++loadToken;
    if (saveTimer) { window.clearTimeout(saveTimer); saveTimer = undefined; }
    loading = true;
    currentDay = day;
    currentOffice = office;
    peopleCache = new Map();
    metaCache = null;
    bases = new Map();
    metaAt = "";
    dirty = new Set();
    deletedIds = new Set();
    metaDirty = false;
    lastError = "";
    loadProgress = "";
    try {
      const r = await fetch(`/api/day?${q(day)}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({ error: `HTTP ${r.status}` }))).error);
      const idx = (await r.json()) as Partial<DayIndex> & { metaAt?: string };
      const refs = idx.people ?? [];
      const total = refs.reduce((n, p) => n + p.files.length + [p.tm7Pdf, p.aiPhoto, p.photo, p.collectImage].filter(Boolean).length, 0);
      let done = 0;
      const tick = () => { done++; loadProgress = `${done}/${total} ไฟล์`; };
      const people = await Promise.all(refs.map((ref) => fromRef(ref, tick)));
      if (token !== loadToken) return { people: [], meta: null, stale: true }; // a newer load took over
      people.sort((a, b) => a.order - b.order);
      for (const p of people) if (!peopleCache.has(p.id)) peopleCache.set(p.id, p);   // an edit made during the load wins
      for (const ref of refs) bases.set(ref.id, stripBlobs(ref));
      metaCache = metaDirty ? metaCache : idx.meta ?? null;
      metaAt = idx.metaAt ?? "";
      return { people: [...peopleCache.values()].sort((a, b) => a.order - b.order), meta: metaCache };
    } catch (e) {
      if (token !== loadToken) return { people: [], meta: null, stale: true };
      lastError = e instanceof Error ? e.message : String(e);
      return { people: [], meta: null };
    } finally {
      if (token === loadToken) {
        loading = false; loadProgress = "";
        if (dirty.size || deletedIds.size || metaDirty) scheduleSave();   // edits made while loading
      }
    }
  }

  function scheduleSave() {
    if (loading) return; // a load is in progress — the load's finally re-arms the save
    if (saveTimer) window.clearTimeout(saveTimer);
    // 2.5 s: every save is a couple of Blob writes (record + manifest), and the
    // Hobby plan has a small monthly budget for those — batch the keystrokes
    saveTimer = window.setTimeout(() => { saveTimer = undefined; void flush(); }, 2500);
  }

  type SaveResponse = { ok: boolean; people?: PersonRef[]; rejected?: string[]; meta?: DayMeta; metaAt?: string; savedAt?: string };

  async function flush(): Promise<void> {
    while (savingPromise) await savingPromise;              // one save at a time, even when timer + tab-hide + pagehide all call
    const day = currentDay;
    if (!day || loading) return;
    const myRun = {};                                        // identity of this save, for the finally below
    saveRun = myRun;
    const mine: Promise<void> = (async () => {
      try {
        // only what changed here: the server merges, so untouched people are left alone
        const ids = [...dirty];
        const dels = [...deletedIds];
        const sendMeta = metaDirty;
        if (!ids.length && !dels.length && !sendMeta) return;
        const sent = new Map<string, Person>();                // the exact objects we serialised
        const refs: PersonRef[] = [];
        const basesOut: Record<string, PersonRef> = {};
        for (const id of ids) {
          const p = peopleCache.get(id);
          if (!p) continue;
          sent.set(id, p);
          refs.push(await toRef(day, p));
          const b = bases.get(id);
          if (b) basesOut[id] = b;
        }
        refs.sort((a, b) => a.order - b.order);
        // `known`: every id on this board here, so the server can repair a manifest entry lost to a racing save
        const body = { v: 2, meta: sendMeta ? metaCache ?? undefined : undefined, metaAt: sendMeta ? metaAt : undefined, people: refs, bases: basesOut, deleted: dels, known: [...peopleCache.keys()] };
        const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
        const r = await fetch(`/api/day?${q(day)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: hidden });
        if (!r.ok) throw new Error((await r.json().catch(() => ({ error: `HTTP ${r.status}` }))).error);
        const res = (await r.json()) as SaveResponse;
        if (day !== currentDay) return;                        // board switched while saving — nothing to apply here
        for (const id of ids) {
          if (peopleCache.get(id) === sent.get(id)) dirty.delete(id);   // unchanged since we serialised it → saved
        }
        for (const id of dels) deletedIds.delete(id);
        let changed = false;
        if (sendMeta) {
          metaDirty = false;
          if (res.metaAt) metaAt = res.metaAt;
          // the server kept newer settings from the other device → show those, not ours
          if (res.meta && JSON.stringify(res.meta) !== JSON.stringify(metaCache)) { metaCache = res.meta; changed = true; }
        }
        for (const rec of res.people ?? []) {
          const before = peopleCache.get(rec.id);
          if (await applyServerRecord(rec, sent.get(rec.id)) && peopleCache.get(rec.id) !== before) changed = true;
        }
        for (const id of res.rejected ?? []) {                 // deleted on another device meanwhile
          if (peopleCache.get(id) === sent.get(id)) { peopleCache.delete(id); dirty.delete(id); bases.delete(id); changed = true; }
        }
        lastError = "";
        lastSavedAt = Date.now();
        if (changed) notify();
        if (dirty.size || deletedIds.size || metaDirty) scheduleSave();   // edits that landed during the save
      } catch (e) {
        lastError = "บันทึกไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e));
        console.warn("[today/store] save failed", e);
      } finally {
        if (saveRun === myRun) savingPromise = null;
      }
    })();
    savingPromise = mine;
    await mine;
  }

  async function savePerson(p: Person): Promise<void> {
    peopleCache.set(p.id, p);
    dirty.add(p.id);
    deletedIds.delete(p.id);
    scheduleSave();
  }

  async function deletePerson(id: string): Promise<void> {
    peopleCache.delete(id);
    dirty.delete(id);
    bases.delete(id);
    deletedIds.add(id);
    scheduleSave();
  }

  // Pull in what another device saved since we loaded: new people, fresher
  // records (unless we have unsaved edits to that person), removals and day
  // settings. One small manifest read; records only for what changed.
  // Returns the board as it now stands, or null when nothing changed.
  let refreshing = false;
  async function refreshFromServer(): Promise<{ people: Person[]; meta: DayMeta | null } | null> {
    if (refreshing || loading || savingPromise || saveTimer || !currentDay) return null;
    refreshing = true;
    try {
      const token = loadToken;
      const day = currentDay;
      const before = new Map(peopleCache);                   // what we had when we asked
      const r = await fetch(`/api/day?${q(day)}&manifest=1`, { cache: "no-store" });
      if (!r.ok) return null;
      const m = (await r.json()) as Partial<Manifest> & { metaAt?: string };
      if (token !== loadToken || loading || !m.entries) return null;
      let changed = false;
      const ids = Object.keys(m.entries);
      for (const id of ids) {
        const local = peopleCache.get(id);
        if (dirty.has(id) || deletedIds.has(id)) continue;
        if (local && m.entries[id].updatedAt === (local.updatedAt ?? "")) continue;
        const pr = await fetch(`/api/day?${q(day)}&person=${encodeURIComponent(id)}`, { cache: "no-store" });
        if (pr.status === 404) {                                 // entry without a record (deleted) → drop it here too
          if (local && !dirty.has(id) && peopleCache.get(id) === local) { peopleCache.delete(id); bases.delete(id); changed = true; }
          continue;
        }
        if (!pr.ok) continue;
        const ref = (await pr.json()) as PersonRef;
        if (token !== loadToken) return null;
        if (dirty.has(id) || peopleCache.get(id) !== local) continue;   // edited here meanwhile — keep ours
        const p = await fromRef(ref);
        if (token !== loadToken) return null;
        if (dirty.has(id) || peopleCache.get(id) !== local) continue;
        peopleCache.set(id, p);
        bases.set(id, stripBlobs(ref));
        changed = true;
      }
      const seen = new Set(ids);
      for (const [id, obj] of before) {
        if (seen.has(id) || dirty.has(id) || peopleCache.get(id) !== obj) continue;
        // not in the manifest: either removed on the other device, or the entry
        // was lost to a racing save — ask for the record before dropping anyone
        const pr = await fetch(`/api/day?${q(day)}&person=${encodeURIComponent(id)}`, { cache: "no-store" });
        if (token !== loadToken) return null;
        if (pr.status === 404 && peopleCache.get(id) === obj && !dirty.has(id)) { peopleCache.delete(id); bases.delete(id); changed = true; }
        // 200 → record exists, manifest just lags: keep it; the next save's `known` repairs the entry
      }
      if (m.meta && !metaDirty && (m.metaAt ?? "") !== metaAt) { metaCache = m.meta; metaAt = m.metaAt ?? ""; changed = true; }
      if (changed) notify();
      return changed ? { people: [...peopleCache.values()].sort((a, b) => a.order - b.order), meta: metaCache } : null;
    } finally {
      refreshing = false;
    }
  }

  async function saveMeta(meta: DayMeta): Promise<void> {
    const day = dayKeyOf(meta.date);
    if (day !== currentDay) return; // date change is handled by loadDay
    metaCache = meta;
    metaDirty = true;
    scheduleSave();
  }

  async function clearDay(date: string): Promise<void> {
    const day = dayKeyOf(date);
    if (saveTimer) window.clearTimeout(saveTimer);
    peopleCache = new Map();
    metaCache = null;
    bases = new Map();
    dirty = new Set();
    deletedIds = new Set();
    metaDirty = false;
    await fetch(`/api/day?${q(day)}`, { method: "DELETE" });
  }

  async function listDays(): Promise<{ date: string; files: number; updated: string }[]> {
    try {
      const r = await fetch(`/api/day/list?ns=${ns}${currentOffice ? `&office=${currentOffice}` : ""}`, { cache: "no-store" });
      if (!r.ok) return [];
      return ((await r.json()) as { days: { date: string; files: number; updated: string }[] }).days;
    } catch {
      return [];
    }
  }

  // Move a person (with all files) into another day's folder on the server.
  async function movePersonToDay(p: Person, targetDate: string): Promise<void> {
    const target = dayKeyOf(targetDate);
    if (target === currentDay) return;
    const r = await fetch(`/api/day?${q(target)}`, { cache: "no-store" });
    if (!r.ok) throw new Error((await r.json().catch(() => ({ error: `HTTP ${r.status}` }))).error);
    const idx = (await r.json()) as Partial<DayIndex>;
    const refs = idx.people ?? [];
    const order = refs.reduce((m, x) => Math.max(m, x.order), 0) + 1;
    // the copy on the target day must start fresh: not a ghost, not arrived
    const ref = await toRef(target, { ...p, order, cancelled: false, movedTo: undefined, arrived: false }, true);
    const next = { v: 2, revive: true, people: [ref], savedAt: now() };
    const w = await fetch(`/api/day?${q(target)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
    if (!w.ok) throw new Error((await w.json().catch(() => ({ error: `HTTP ${w.status}` }))).error);
    if (((await w.json()) as { rejected?: string[] }).rejected?.includes(p.id)) throw new Error("ปลายทางไม่รับรายการนี้ (ถูกลบไว้) — ลองใหม่อีกครั้ง");
    // re-moving a ghost (already moved once): pull the stale copy out of the previous target day
    if (p.movedTo) {
      const prev = dayKeyOf(p.movedTo);
      if (prev !== target && prev !== currentDay) {
        await fetch(`/api/day?${q(prev)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ v: 2, people: [], savedAt: now(), deleted: [p.id] }) });
      }
    }
    // keep a ghost on the original day so the day's summary shows the reschedule
    await savePerson({ ...p, movedTo: targetDate, arrived: false });
  }

  // Move a person (with all files) to another office's board on the same day.
  // Unlike a reschedule there is no ghost left behind — the customer was simply
  // filed under the wrong counter. The TM.7 packet is dropped because its
  // "written at" / page set depends on the office; regenerate it there.
  async function movePersonToOffice(p: Person, targetOffice: string): Promise<void> {
    if (!targetOffice || targetOffice === currentOffice) return;
    const day = currentDay;
    const r = await fetch(`/api/day?${q(day, targetOffice)}`, { cache: "no-store" });
    if (!r.ok) throw new Error((await r.json().catch(() => ({ error: `HTTP ${r.status}` }))).error);
    const idx = (await r.json()) as Partial<DayIndex>;
    const refs = idx.people ?? [];
    const order = refs.reduce((m, x) => Math.max(m, x.order), 0) + 1;
    const ref = await toRef(day, { ...p, order, tm7Pdf: undefined, cancelled: false, movedTo: undefined, arrived: false }, true, targetOffice);
    const next = { v: 2, revive: true, people: [ref], savedAt: now() };
    const w = await fetch(`/api/day?${q(day, targetOffice)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
    if (!w.ok) throw new Error((await w.json().catch(() => ({ error: `HTTP ${w.status}` }))).error);
    if (((await w.json()) as { rejected?: string[] }).rejected?.includes(p.id)) throw new Error("หน้างานปลายทางไม่รับรายการนี้ — ยังไม่ได้ย้าย ลองใหม่อีกครั้ง");
    await deletePerson(p.id);
  }

  // ---------- recovery ----------
  // Pull a person found by /api/day/recover (legacy or another office's index)
  // onto the open board: files are downloaded from wherever they are and
  // re-uploaded under this office so the copy survives a later clean-up.
  async function importRef(ref: PersonRef): Promise<Person> {
    const p = await fromRef(ref);
    const existing = peopleCache.get(p.id);
    const order = existing ? existing.order : [...peopleCache.values()].reduce((m, x) => Math.max(m, x.order), 0) + 1;
    // re-pull of someone already on the board: keep what was edited here, take the files from the source
    const fresh: Person = existing
      ? { ...existing, files: p.files.length ? p.files : existing.files, photo: p.photo ?? existing.photo, aiPhoto: p.aiPhoto ?? existing.aiPhoto, collectImage: p.collectImage ?? existing.collectImage }
      : { ...p, order, movedTo: undefined };
    await toRef(currentDay, fresh, true);          // force: upload into this office's folder
    await savePerson(fresh);
    return fresh;
  }
  // Same, but straight onto another office's board for this day (no need to
  // switch boards first). Replaces the same person there if already present.
  async function importRefTo(ref: PersonRef, targetOffice: string): Promise<void> {
    if (!targetOffice || targetOffice === currentOffice) { await importRef(ref); return; }
    const day = currentDay;
    const p = await fromRef(ref);
    const r = await fetch(`/api/day?${q(day, targetOffice)}`, { cache: "no-store" });
    if (!r.ok) throw new Error((await r.json().catch(() => ({ error: `HTTP ${r.status}` }))).error);
    const idx = (await r.json()) as Partial<DayIndex>;
    const refs = idx.people ?? [];
    const existing = refs.find((x) => x.id === p.id);
    const order = existing ? existing.order : refs.reduce((m, x) => Math.max(m, x.order), 0) + 1;
    const out = await toRef(day, { ...p, order, movedTo: undefined }, true, targetOffice);
    const next = { v: 2, revive: true, people: [out], savedAt: now() };
    const w = await fetch(`/api/day?${q(day, targetOffice)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
    if (!w.ok) throw new Error((await w.json().catch(() => ({ error: `HTTP ${w.status}` }))).error);
    if (((await w.json()) as { rejected?: string[] }).rejected?.includes(p.id)) throw new Error("หน้างานปลายทางไม่รับรายการนี้ — ลองใหม่อีกครั้ง");
  }
  // Download loose files (an orphan folder) so the board can re-read them like a fresh drop.
  async function fetchFiles(paths: string[]): Promise<File[]> {
    const out: File[] = [];
    for (const path of paths) {
      const b = await downloadBlob(path);
      if (b) out.push(new File([b], path.split("/").pop() ?? "file", { type: b.type }));
    }
    return out;
  }

  function isSaving(): boolean {
    return !!savingPromise || !!saveTimer;
  }

  return {
    loadDay, flush, savePerson, deletePerson, saveMeta, clearDay, listDays, movePersonToDay, movePersonToOffice, importRef, importRefTo, fetchFiles, refreshFromServer, subscribe,
    isSaving, isLoading,
    lastError: () => lastError,
    lastSavedAt: () => lastSavedAt,
    loadProgress: () => loadProgress,
  };
}
export type DayStore = ReturnType<typeof createDayStore>;

// Extension board ("days/") — the original named API.
export const daysStore = createDayStore("days");
// Visa-run board ("run/").
export const runStore = createDayStore("run");

export const loadDay = daysStore.loadDay;
export const flush = daysStore.flush;
export const savePerson = daysStore.savePerson;
export const deletePerson = daysStore.deletePerson;
export const saveMeta = daysStore.saveMeta;
export const clearDay = daysStore.clearDay;
export const listDays = daysStore.listDays;
export const movePersonToDay = daysStore.movePersonToDay;
export const movePersonToOffice = daysStore.movePersonToOffice;
export const isSaving = daysStore.isSaving;
export const isLoading = daysStore.isLoading;
export const lastError = daysStore.lastError;
export const lastSavedAt = daysStore.lastSavedAt;
export const loadProgress = daysStore.loadProgress;
