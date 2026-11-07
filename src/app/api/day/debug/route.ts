// GET /api/day/debug — round-trip test of the Blob store (signed-in only).
// Writes a tiny file, lists it, reads it back, deletes it, and reports every
// raw step so a storage problem can be diagnosed from the browser.
import { NextResponse } from "next/server";
import { blobDelete, blobFetchUrl, blobList, blobPut } from "@/lib/blob";

export const runtime = "nodejs";

export async function GET() {
  const steps: Record<string, unknown> = { hasToken: !!process.env.BLOB_READ_WRITE_TOKEN, tokenPrefix: (process.env.BLOB_READ_WRITE_TOKEN ?? "").slice(0, 12) };
  const path = `days/00000000/debug/ping-${Date.now()}.json`;
  try {
    const put = await blobPut(path, JSON.stringify({ t: Date.now() }), "application/json");
    steps.put = put;
    const listed = await blobList("days/00000000/");
    steps.listed = listed.map((b) => ({ pathname: b.pathname, size: b.size }));
    const r = await blobFetchUrl(put.url);
    steps.read = { status: r.status, body: (await r.text()).slice(0, 100) };
    await blobDelete(listed.map((b) => b.url));
    steps.deleted = listed.length;
    const days = await blobList("days/");
    steps.allDayBlobs = days.map((b) => `${b.pathname} (${b.size})`).slice(0, 50);
    steps.ok = true;
  } catch (e) {
    steps.ok = false;
    steps.error = e instanceof Error ? e.message : String(e);
  }
  return NextResponse.json(steps, { headers: { "Cache-Control": "no-store" } });
}
