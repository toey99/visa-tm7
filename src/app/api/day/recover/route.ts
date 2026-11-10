// GET /api/day/recover?date=DDMMYYYY[&ns=run]
// Everything the store still holds for one date, wherever it sits: the legacy
// (pre office-split) index, every office's index, and "orphan" person folders
// whose files are on the server but referenced by no index any more. The
// board's recovery panel lets the user pull any of it back onto a board.
import { NextRequest, NextResponse } from "next/server";
import { blobGetJson, blobList } from "@/lib/blob";

export const runtime = "nodejs";

type AnyIndex = { meta?: { office?: string; date?: string }; savedAt?: string; people?: Array<{ id: string; order?: number; fields?: Record<string, string>; files?: Array<{ path: string; kind?: string }>; photo?: string; aiPhoto?: string; tm7Pdf?: string; collectImage?: string; cancelled?: boolean; movedTo?: string }> };

const OFFICE_RE = /^[A-Z][A-Z0-9_]+$/;

export async function GET(req: NextRequest) {
  const ns = req.nextUrl.searchParams.get("ns") === "run" ? "run" : "days";
  const day = req.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{8}$/.test(day)) return NextResponse.json({ error: "date=DDMMYYYY required" }, { status: 400 });
  try {
    const blobs = await blobList(`${ns}/${day}/`);
    const indexPaths = blobs.map((b) => b.pathname).filter((p) => p === `${ns}/${day}/index.json` || new RegExp(`^${ns}/${day}/[A-Z][A-Z0-9_]+/index\\.json$`).test(p));
    // offices stored as per-person records (current format) — one source per office folder
    const recordOffices = Array.from(new Set(blobs.map((b) => b.pathname.match(new RegExp(`^${ns}/${day}/([A-Z][A-Z0-9_]+)/people/[^/]+\\.json$`))?.[1]).filter((x): x is string => !!x)));
    const onServer = new Set(blobs.map((b) => b.pathname));
    const sizeOf = new Map<string, number>(blobs.map((b) => [b.pathname, b.size] as [string, number]));
    const recordSources = await Promise.all(recordOffices.map(async (office) => {
      const recs = blobs.filter((b) => b.pathname.startsWith(`${ns}/${day}/${office}/people/`) && b.pathname.endsWith(".json"));
      const people = (await Promise.all(recs.map((b) => blobGetJson<NonNullable<AnyIndex["people"]>[number]>(b.pathname)))).filter((x): x is NonNullable<typeof x> => !!x);
      const meta = await blobGetJson<{ office?: string }>(`${ns}/${day}/${office}/meta.json`);
      const savedAt = recs.reduce((m, b) => (b.uploadedAt > m ? b.uploadedAt : m), "");
      return { path: `${ns}/${day}/${office}/people/`, idx: { meta: meta ?? undefined, savedAt, people } as AnyIndex, source: office };
    }));
    const indexSources = await Promise.all(indexPaths.map(async (path) => {
      const seg = path.split("/")[2];
      const source = seg === "index.json" ? "legacy" : seg;
      // an office that already has records: its old index.json is just the frozen backup — skip it
      if (source !== "legacy" && recordOffices.includes(source)) return null;
      return { path, idx: (await blobGetJson<AnyIndex>(path)) ?? {}, source };
    }));
    const sources = [...recordSources, ...indexSources.filter((x): x is NonNullable<typeof x> => !!x)].map(({ idx, source }) => {
      return {
        source,                                   // "legacy" or the office folder
        office: idx.meta?.office ?? "",
        savedAt: idx.savedAt ?? "",
        people: (idx.people ?? []).map((p) => {
          // which of this person's files are really on the server (and not 0-byte)
          const paths = [...(p.files ?? []).map((f) => f.path), p.photo, p.aiPhoto, p.tm7Pdf, p.collectImage].filter((x): x is string => !!x);
          const present = paths.filter((x) => onServer.has(x) && (sizeOf.get(x) ?? 0) > 0).length;
          return { ...p, files: p.files ?? [], filesTotal: paths.length, filesPresent: present };
        }),
      };
    });
    // orphan person folders: files on the server that no index points at
    const referenced = new Set<string>();
    for (const s of sources) for (const p of s.people) { for (const f of p.files) referenced.add(f.path); for (const x of [p.photo, p.aiPhoto, p.tm7Pdf, p.collectImage]) if (x) referenced.add(x); }
    const orphanMap = new Map<string, { where: string; personId: string; files: string[]; updated: string }>();
    for (const b of blobs) {
      if (b.pathname.endsWith("/index.json") || b.pathname.endsWith("/meta.json") || /\/people\/[^/]+\.json$/.test(b.pathname) || referenced.has(b.pathname)) continue;
      const parts = b.pathname.split("/");         // ns / day / (OFFICE /)? personId / file
      const where = OFFICE_RE.test(parts[2]) ? parts[2] : "legacy";
      const personId = where === "legacy" ? parts[2] : parts[3];
      if (!personId || parts.length < (where === "legacy" ? 4 : 5)) continue;
      const key = `${where}/${personId}`;
      const cur = orphanMap.get(key) ?? { where, personId, files: [] as string[], updated: b.uploadedAt };
      cur.files.push(b.pathname);
      if (b.uploadedAt > cur.updated) cur.updated = b.uploadedAt;
      orphanMap.set(key, cur);
    }
    return NextResponse.json({ sources, orphans: [...orphanMap.values()], total: blobs.length }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "recover failed" }, { status: 500 });
  }
}
