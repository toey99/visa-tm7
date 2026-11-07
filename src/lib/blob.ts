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
      "x-add-random-suffix": "0",
      "x-allow-overwrite": "1",
      "x-cache-control-max-age": "0",
    },
    body,
  });
  if (!r.ok) throw new Error(`Blob upload failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { url: string; pathname: string; size?: number; uploadedAt?: string };
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

/** Fetch a blob's bytes by pathname (looked up via list, so no URL is stored client-side). */
export async function blobGetByPath(pathname: string): Promise<Response | null> {
  const found = (await blobList(pathname)).find((b) => b.pathname === pathname);
  if (!found) return null;
  return blobFetchUrl(found.url);
}

/** Fetch a blob by its store URL. Works for Private stores (token sent) and Public ones alike. */
export function blobFetchUrl(url: string): Promise<Response> {
  return fetch(url, { headers: { authorization: `Bearer ${token()}` }, cache: "no-store" });
}

export async function blobGetJson<T>(pathname: string): Promise<T | null> {
  const r = await blobGetByPath(pathname);
  if (!r || !r.ok) return null;
  return (await r.json()) as T;
}
