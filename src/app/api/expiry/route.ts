// Expiry ledger — one small JSON record per passport (latest job wins), kept
// so the "ใกล้หมดอายุ" page can warn the factory / agent before a worker
// overstays, and so the next run or extension can be booked in time.
// Not touched by the weekly purge; records are dropped 120 days after expiry.
// GET    /api/expiry                      → { records: [...] } soonest expiry first
// POST   /api/expiry  body: { records: ExpiryRecord[] }  → upsert by passport no.
// DELETE /api/expiry?pp=<passport>        → remove one record
import { NextRequest, NextResponse } from "next/server";
import { blobDelete, blobFetchUrl, blobList, blobPut } from "@/lib/blob";

export const runtime = "nodejs";

export type ExpiryRecord = {
  passportNo: string;
  name: string;                // EN
  cn: string;                  // 中文
  agent: string;               // factory / agent that sent the case
  phone?: string;
  kind: "run" | "run30" | "ext";
  office: string;              // OfficeId
  jobDate: string;             // DD/MM/YYYY — the run / filing day
  entry: string;               // DD/MM/YYYY — entry stamp used
  expiry: string;              // DD/MM/YYYY — new admitted-until
  updatedAt: string;           // ISO
};

const ISO = (ddmmyyyy: string) => { const m = ddmmyyyy.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };
const ppKey = (pp: string) => pp.toUpperCase().replace(/[^A-Z0-9]/g, "");

export async function GET() {
  try {
    const blobs = await blobList("expiry/");
    const records: ExpiryRecord[] = [];
    await Promise.all(blobs.map(async (b) => {
      const r = await blobFetchUrl(b.url);
      if (r.ok) records.push({ ...((await r.json()) as ExpiryRecord), passportNo: b.pathname.replace(/^expiry\//, "").replace(/\.json$/, "") });
    }));
    // purge: expired more than 120 days ago
    const cutoff = new Date(Date.now() + 7 * 3600 * 1000 - 120 * 86400 * 1000).toISOString().slice(0, 10);
    const old = records.filter((r) => ISO(r.expiry) && ISO(r.expiry) < cutoff);
    if (old.length) {
      const urls = blobs.filter((b) => old.some((r) => b.pathname === `expiry/${r.passportNo}.json`)).map((b) => b.url);
      if (urls.length) await blobDelete(urls);
    }
    const keep = records.filter((r) => !old.includes(r)).sort((a, b) => ISO(a.expiry).localeCompare(ISO(b.expiry)));
    return NextResponse.json({ records: keep }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "list failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { records: ExpiryRecord[] };
    const list = (body.records ?? []).filter((r) => r && ppKey(r.passportNo) && /^\d{2}\/\d{2}\/\d{4}$/.test(r.expiry));
    if (!list.length) return NextResponse.json({ error: "no valid records (passport + expiry required)" }, { status: 400 });
    const updatedAt = new Date().toISOString();
    await Promise.all(list.map((r) => blobPut(`expiry/${ppKey(r.passportNo)}.json`, JSON.stringify({ ...r, passportNo: ppKey(r.passportNo), updatedAt }), "application/json")));
    return NextResponse.json({ ok: true, saved: list.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "save failed" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const pp = ppKey(req.nextUrl.searchParams.get("pp") ?? "");
  if (!pp) return NextResponse.json({ error: "pp required" }, { status: 400 });
  try {
    const found = (await blobList(`expiry/${pp}.json`)).filter((b) => b.pathname === `expiry/${pp}.json`);
    if (found.length) await blobDelete(found.map((b) => b.url));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "delete failed" }, { status: 500 });
  }
}
