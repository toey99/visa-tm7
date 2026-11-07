// IndexedDB persistence for the /today board (client only).
//
// Everything for the current day — people, their fields and the file blobs —
// lives in the browser, so closing the tab or refreshing loses nothing. The
// store is a single object store keyed by record id; a "meta" record holds the
// day settings. No server storage is involved.

import type { DayMeta, Person } from "./types";

const DB_NAME = "toyka-today";
const DB_VERSION = 1;
const STORE = "records";

type Record_ = { id: string; kind: "person"; value: Person } | { id: "meta"; kind: "meta"; value: DayMeta };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadAll(): Promise<{ people: Person[]; meta: DayMeta | null }> {
  try {
    const db = await openDb();
    const all = (await wrap(tx(db, "readonly").getAll())) as Record_[];
    db.close();
    const people = all.filter((r): r is Extract<Record_, { kind: "person" }> => r.kind === "person").map((r) => r.value);
    people.sort((a, b) => a.order - b.order);
    const metaRec = all.find((r) => r.kind === "meta") as Extract<Record_, { kind: "meta" }> | undefined;
    return { people, meta: metaRec?.value ?? null };
  } catch {
    return { people: [], meta: null };
  }
}

export async function savePerson(p: Person): Promise<void> {
  try {
    const db = await openDb();
    await wrap(tx(db, "readwrite").put({ id: p.id, kind: "person", value: p } satisfies Record_));
    db.close();
  } catch (err) {
    console.warn("[today/store] savePerson failed", err);
  }
}

export async function deletePerson(id: string): Promise<void> {
  try {
    const db = await openDb();
    await wrap(tx(db, "readwrite").delete(id));
    db.close();
  } catch (err) {
    console.warn("[today/store] deletePerson failed", err);
  }
}

export async function saveMeta(meta: DayMeta): Promise<void> {
  try {
    const db = await openDb();
    await wrap(tx(db, "readwrite").put({ id: "meta", kind: "meta", value: meta } satisfies Record_));
    db.close();
  } catch (err) {
    console.warn("[today/store] saveMeta failed", err);
  }
}

export async function clearAll(): Promise<void> {
  try {
    const db = await openDb();
    await wrap(tx(db, "readwrite").clear());
    db.close();
  } catch (err) {
    console.warn("[today/store] clearAll failed", err);
  }
}
