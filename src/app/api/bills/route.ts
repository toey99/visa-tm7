// Bill register — small JSON records kept for a year so a customer can ask for
// a receipt again. Not touched by the weekly purge.
// GET  /api/bills?q=<name or passport>  → { bills: [...] } newest first (all years)
// POST /api/bills  body: BillRecord (id assigned here) → { id }
import { NextRequest, NextResponse } from "next/server";
import { blobDelete, blobGetJson, blobList, blobPut } from "@/lib/blob";

export const runtime = "nodejs";

export type BillRecord = {
  id: string;
  createdAt: string;           // ISO
  date: string;                // DD/MM/YYYY (appointment day)
  office: string;
  amount: number;
  customers: { en: string; cn: string; pp: string }[];
  note?: string;
};

export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim().toUpperCase();
  try {
    const blobs = await blobList("bills/");
    // purge > 1 year
    const cutoff = Date.now() - 366 * 86400 * 1000;
    const old = blobs.filter((b) => new Date(b.uploadedAt).getTime() < cutoff);
    if (old.length) await blobDelete(old.map((b) => b.url));
    const keep = blobs.filter((b) => !old.includes(b)).sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).slice(0, 400);
    const bills: BillRecord[] = [];
    await Promise.all(keep.map(async (b) => {
      const r = await fetch(b.url, { cache: "no-store" });
      if (r.ok) bills.push((await r.json()) as BillRecord);
    }));
    bills.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const filtered = q
      ? bills.filter((b) => b.customers.some((c) => `${c.en} ${c.cn} ${c.pp}`.toUpperCase().includes(q)))
      : bills;
    return NextResponse.json({ bills: filtered }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "list failed" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Omit<BillRecord, "id" | "createdAt">;
    if (!Array.isArray(body.customers) || !body.customers.length) return NextResponse.json({ error: "customers required" }, { status: 400 });
    const createdAt = new Date().toISOString();
    const id = `${createdAt.slice(0, 10).replace(/-/g, "")}-${Math.random().toString(36).slice(2, 8)}`;
    const rec: BillRecord = { ...body, id, createdAt };
    await blobPut(`bills/${createdAt.slice(0, 4)}/${id}.json`, JSON.stringify(rec), "application/json");
    const existing = await blobGetJson<BillRecord>(`bills/${createdAt.slice(0, 4)}/${id}.json`);
    return NextResponse.json({ id, ok: !!existing });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "save failed" }, { status: 500 });
  }
}
