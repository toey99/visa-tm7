// Transfer-slip room (see src/lib/slips/). Signed-in users only — the proxy gates this route.
// GET  /api/slips?book=ARTAO[&day=YYYY-MM-DD] → { book, day, round, closed, items }   (day defaults to the open round)
// POST /api/slips  JSON { book, action, … }
//   update  { id, day, patch: { amount?, excluded?, note?, isSlip?, dupOf?: null } }
//   move    { id, day, to }          → another accounting round
//   delete  { id, day }
//   close   { day } / reopen { day }
import { NextRequest, NextResponse } from "next/server";
import { deleteSlip, getSlip, listSlips, loadSlipState, moveSlip, safeDay, safeSlipId, saveSlip, saveSlipState } from "@/lib/slips/store";
import { isSlipBook, roundFor, type SlipItem } from "@/lib/slips/types";

export const runtime = "nodejs";
const noStore = { headers: { "Cache-Control": "no-store" } };
const fail = (e: unknown, status = 500) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

export async function GET(req: NextRequest) {
  const book = req.nextUrl.searchParams.get("book") ?? "ARTAO";
  if (!isSlipBook(book)) return fail("unknown book", 400);
  try {
    const state = await loadSlipState(book);
    const round = roundFor(state, Date.now());
    const day = safeDay(req.nextUrl.searchParams.get("day")) ?? round;
    return NextResponse.json({ book, day, round, closed: state.closed, items: await listSlips(book, day) }, noStore);
  } catch (e) {
    return fail(e);
  }
}

type Body = { book?: string; action?: string; id?: string; day?: string; to?: string; patch?: Partial<Pick<SlipItem, "amount" | "excluded" | "note" | "isSlip">> & { dupOf?: null } };

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = (await req.json()) as Body; } catch { return fail("bad JSON", 400); }
  const book = body.book ?? "ARTAO";
  if (!isSlipBook(book)) return fail("unknown book", 400);
  const day = safeDay(body.day);
  if (!day) return fail("day must be YYYY-MM-DD", 400);
  try {
    if (body.action === "close" || body.action === "reopen") {
      const state = await loadSlipState(book);
      if (body.action === "close") state.closed[day] = Date.now(); else delete state.closed[day];
      await saveSlipState(book, state);
      return NextResponse.json({ ok: true, closed: state.closed, round: roundFor(state, Date.now()) }, noStore);
    }
    const id = safeSlipId(body.id);
    if (!id) return fail("id required", 400);
    const item = await getSlip(book, day, id);
    if (!item) return fail("ไม่พบสลิปนี้ (อาจถูกย้ายหรือลบไปแล้ว) — รีเฟรชหน้า", 404);

    if (body.action === "update") {
      const p = body.patch ?? {};
      const next: SlipItem = { ...item };
      if (typeof p.amount === "number" && Number.isFinite(p.amount) && p.amount >= 0 && p.amount < 100_000_000) next.amount = Math.round(p.amount * 100) / 100;
      if (typeof p.excluded === "boolean") next.excluded = p.excluded;
      if (typeof p.isSlip === "boolean") next.isSlip = p.isSlip;
      if (typeof p.note === "string") next.note = p.note.slice(0, 200);
      if (p.dupOf === null) delete next.dupOf;                 // "it is not a duplicate after all"
      await saveSlip(book, next);
    } else if (body.action === "move") {
      const to = safeDay(body.to);
      if (!to) return fail("to must be YYYY-MM-DD", 400);
      await moveSlip(book, item, to);
    } else if (body.action === "delete") {
      await deleteSlip(book, item);
    } else return fail("unknown action", 400);

    return NextResponse.json({ ok: true, items: await listSlips(book, day) }, noStore);
  } catch (e) {
    return fail(e);
  }
}
