// =============================================================
// Supabase backend for the storage layer (server only, no npm dependency)
// =============================================================
// Same contract as the Vercel Blob client in blob.ts — put / get / list / delete by path —
// so nothing above this layer changes. JSON documents are rows in `docs`; binary files are
// objects in the private Storage bucket "files" plus an index row in `files` (listing a prefix
// is then one query instead of walking folders). See supabase/schema.sql.
//
// Turned on by SUPABASE_URL + SUPABASE_SECRET_KEY (the project's secret / service-role key).
import type { BlobInfo } from "./blob";

const BUCKET = "files";
const DOC = "doc://", FILE = "file://";   // the "url" handed back in BlobInfo: scheme + path

export const supabaseOn = () => !!(process.env.SUPABASE_URL && (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY));
const base = () => (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = () => process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const auth = (): Record<string, string> => ({ apikey: key(), authorization: `Bearer ${key()}` });
const isJson = (path: string) => path.toLowerCase().endsWith(".json");
const encPath = (path: string) => path.split("/").map(encodeURIComponent).join("/");
const likePrefix = (prefix: string) => `${prefix.replace(/[\\%_]/g, (m) => `\\${m}`)}*`;   // PostgREST: * is the wildcard
const inList = (paths: string[]) => `(${paths.map((p) => `"${p.replace(/["\\]/g, (m) => `\\${m}`)}"`).join(",")})`;

async function rest(table: "docs" | "files", query: string, init?: RequestInit): Promise<Response> {
  return fetch(`${base()}/rest/v1/${table}${query}`, { ...init, headers: { ...auth(), ...(init?.headers as Record<string, string> | undefined) }, cache: "no-store" });
}
async function fail(what: string, r: Response): Promise<never> { throw new Error(`Supabase ${what} failed (${r.status}): ${(await r.text()).slice(0, 200)}`); }

export async function sbPut(path: string, body: Blob | ArrayBuffer | string, contentType: string): Promise<BlobInfo> {
  const now = new Date().toISOString();
  if (isJson(path)) {
    const text = typeof body === "string" ? body : await new Response(body).text();
    const r = await rest("docs", "?on_conflict=path", {
      method: "POST",
      headers: { "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify([{ path, body: JSON.parse(text), updated_at: now }]),
    });
    if (!r.ok) await fail("save", r);
    return { url: DOC + path, pathname: path, size: text.length, uploadedAt: now };
  }
  const bytes = typeof body === "string" ? new Blob([body]) : body instanceof Blob ? body : new Blob([body]);
  const up = await fetch(`${base()}/storage/v1/object/${BUCKET}/${encPath(path)}`, { method: "POST", headers: { ...auth(), "content-type": contentType || "application/octet-stream", "x-upsert": "true", "cache-control": "max-age=0" }, body: bytes });
  if (!up.ok) await fail("upload", up);
  const r = await rest("files", "?on_conflict=path", {
    method: "POST",
    headers: { "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{ path, size: bytes.size, content_type: contentType || "application/octet-stream", updated_at: now }]),
  });
  if (!r.ok) await fail("file index", r);
  return { url: FILE + path, pathname: path, size: bytes.size, uploadedAt: now };
}

/** The content at `path` as a Response (JSON documents are served as JSON text), or null when there is none. */
export async function sbGet(path: string): Promise<Response | null> {
  if (isJson(path)) {
    const r = await rest("docs", `?path=eq.${encodeURIComponent(path)}&select=body`);
    if (!r.ok) await fail("read", r);
    const rows = (await r.json()) as { body: unknown }[];
    return rows.length ? new Response(JSON.stringify(rows[0].body), { status: 200, headers: { "content-type": "application/json" } }) : null;
  }
  const r = await fetch(`${base()}/storage/v1/object/${BUCKET}/${encPath(path)}`, { headers: auth(), cache: "no-store" });
  if (r.status === 404 || r.status === 400) return null;   // Storage answers 400 "Object not found" for a missing object
  return r;
}

/** Many JSON documents under one prefix in a single query (what a month of ledger days needs). */
export async function sbGetJsonMany<T>(prefix: string): Promise<Map<string, T>> {
  const out = new Map<string, T>();
  for (let offset = 0; ; offset += 1000) {
    const r = await rest("docs", `?path=like.${encodeURIComponent(likePrefix(prefix))}&select=path,body&order=path&limit=1000&offset=${offset}`);
    if (!r.ok) await fail("read", r);
    const rows = (await r.json()) as { path: string; body: T }[];
    for (const x of rows) out.set(x.path, x.body);
    if (rows.length < 1000) break;
  }
  return out;
}

export async function sbList(prefix: string): Promise<BlobInfo[]> {
  const out: BlobInfo[] = [];
  for (const [table, scheme, cols] of [["docs", DOC, "path,updated_at"], ["files", FILE, "path,size,updated_at"]] as const) {
    for (let offset = 0; ; offset += 1000) {
      const r = await rest(table, `?path=like.${encodeURIComponent(likePrefix(prefix))}&select=${cols}&order=path&limit=1000&offset=${offset}`);
      if (!r.ok) await fail("list", r);
      const rows = (await r.json()) as { path: string; size?: number; updated_at: string }[];
      for (const x of rows) out.push({ url: scheme + x.path, pathname: x.path, size: x.size ?? 0, uploadedAt: x.updated_at });
      if (rows.length < 1000) break;
    }
  }
  return out.sort((a, b) => (a.pathname < b.pathname ? -1 : a.pathname > b.pathname ? 1 : 0));
}

const pathOf = (url: string) => (url.startsWith(DOC) ? url.slice(DOC.length) : url.startsWith(FILE) ? url.slice(FILE.length) : url);

export async function sbDelete(urlsOrPaths: string[]): Promise<void> {
  const paths = urlsOrPaths.map(pathOf);
  const docs = paths.filter(isJson), files = paths.filter((p) => !isJson(p));
  for (let i = 0; i < docs.length; i += 50) {
    const r = await rest("docs", `?path=in.${encodeURIComponent(inList(docs.slice(i, i + 50)))}`, { method: "DELETE" });
    if (!r.ok) await fail("delete", r);
  }
  for (let i = 0; i < files.length; i += 50) {
    const part = files.slice(i, i + 50);
    const d = await fetch(`${base()}/storage/v1/object/${BUCKET}`, { method: "DELETE", headers: { ...auth(), "content-type": "application/json" }, body: JSON.stringify({ prefixes: part }) });
    if (!d.ok) await fail("file delete", d);
    const r = await rest("files", `?path=in.${encodeURIComponent(inList(part))}`, { method: "DELETE" });
    if (!r.ok) await fail("file index delete", r);
  }
}

export async function sbFetchUrl(url: string): Promise<Response> {
  return (await sbGet(pathOf(url))) ?? new Response("not found", { status: 404 });
}

/** Sizes of the files already stored under a prefix (the importer skips those). */
export async function sbFileSizes(prefix: string): Promise<Map<string, number>> {
  return new Map((await sbList(prefix)).filter((b) => b.url.startsWith(FILE)).map((b) => [b.pathname, b.size]));
}
