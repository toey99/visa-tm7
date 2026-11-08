// =============================================================
// Vercel Blob — thin REST client (server only)
// =============================================================
// Talks to the Blob store directly over HTTPS so the app adds no npm
// dependency. Needs BLOB_READ_WRITE_TOKEN (added automatically when a Blob
// store is connected to the Vercel project).
//
// Layout in the store:
//   days/DDMMYYYY/index.json                 — the day's people + meta (no binaries)
//   days/DDMMYYYY/<personId>/<fileId>.<ext>  — uploaded documents and generated outputs
//   bills/YYYY/<billId>.json                 — bill register (kept 1 year, not purged weekly)

const API = "https://blob.vercel-storage.com";

function token(): string {
  const t = process.env.BLOB_READ_WRITE_TOKEN;
  if (!t) throw new Error("Server is missing BLOB_READ_WRITE_TOKEN — connect a Vercel Blob store to this project (Storage → Create → Blob).");
  return t;
}

export type BlobInfo = { url: string; pathname: string; size: number; uploadedAt: string };

export async function blobPut(pathname: string, body: Blob | ArrayBuffer | string, contentType: string): Promise<BlobInfo> {
  const r = await fetch(`${API}/${pathname.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token()}`,
      "x-api-version": "7",
      "x-content-type": contentType,
      "x-vercel-blob-access": "private",
      "x-add-random-suffix": "0",
      "x-allow-overwrite": "1",
      "x-cache-control-max-age": "0",
    },
    body,
  });
  if (!r.ok) throw new Error(`Blob upload failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { url: string; pathname: string; size?: number; uploadedAt?: string };
  learnBase(j.url, j.pathname);
  return { url: j.url, pathname: j.pathname, size: j.size ?? 0, uploadedAt: j.uploadedAt ?? new Date().toISOString() };
}

export async function blobList(prefix: string): Promise<BlobInfo[]> {
  const out: BlobInfo[] = [];
  let cursor: string | undefined;
  do {
    const u = new URL(API);
    u.searchParams.set("prefix", prefix);
    u.searchParams.set("limit", "1000");
    if (cursor) u.searchParams.set("cursor", cursor);
    const r = await fetch(u, { headers: { authorization: `Bearer ${token()}`, "x-api-version": "7" }, cache: "no-store" });
    if (!r.ok) throw new Error(`Blob list failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { blobs: BlobInfo[]; cursor?: string; hasMore?: boolean };
    out.push(...j.blobs);
    cursor = j.hasMore ? j.cursor : undefined;
  } while (cursor);
  return out;
}

export async function blobDelete(urls: string[]): Promise<void> {
  for (let i = 0; i < urls.length; i += 100) {
    const r = await fetch(`${API}/delete`, {
      method: "POST",
      headers: { authorization: `Bearer ${token()}`, "x-api-version": "7", "content-type": "application/json" },
      body: JSON.stringify({ urls: urls.slice(i, i + 100) }),
    });
    if (!r.ok) throw new Error(`Blob delete failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  }
}

// ---- reads ---------------------------------------------------------------
// Every list() call is an "Advanced Operation" (2,000/month on Hobby — the
// store gets suspended when that runs out). So reads must NOT go through
// list(): we build the blob URL ourselves from the store's base URL, which we
// learn from the first put() (or BLOB_BASE_URL) and remember per instance.
let baseUrl: string | null = process.env.BLOB_BASE_URL ?? null;
function learnBase(url: string, pathname: string) {
  if (!baseUrl && url.endsWith(pathname)) baseUrl = url.slice(0, url.length - pathname.length);
}

/** Fetch a blob's bytes by pathname. consistent=true bypasses the CDN (for files that get overwritten, e.g. index.json). */
export async function blobGetByPath(pathname: string, consistent = false): Promise<Response | null> {
  if (baseUrl) {
    const r = await blobFetchUrl(`${baseUrl}${pathname.split("/").map(encodeURIComponent).join("/")}`, consistent);
    if (r.ok) return r;
    if (r.status !== 404) return r;
    return null;
  }
  // base URL not known yet (fresh instance, nothing uploaded): one list() to learn it
  const all = await blobList(pathname);
  const found = all.find((b) => b.pathname === pathname);
  if (!found) return null;
  learnBase(found.url, found.pathname);
  return blobFetchUrl(found.url, consistent);
}

/** Fetch a blob by its store URL. consistent=true adds Vercel Blob's `cache=0` (latest write, bypasses CDN). */
export function blobFetchUrl(url: string, consistent = false): Promise<Response> {
  const u = new URL(url);
  if (consistent) u.searchParams.set("cache", "0");
  return fetch(u, { headers: { authorization: `Bearer ${token()}` }, cache: "no-store" });
}

export async function blobGetJson<T>(pathname: string): Promise<T | null> {
  const r = await blobGetByPath(pathname, true); // JSON indexes are overwritten → always read the latest
  if (!r || !r.ok) return null;
  return (await r.json()) as T;
}
