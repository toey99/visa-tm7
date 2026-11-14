// GET  /api/ledger?book=ARTAO[&to=YYYY-MM-DD]        → { config, days: DayLedger[] } from the opening day to `to` (default today)
// POST /api/ledger  body: { book, day, adjustments?, note?, close?, reopen? }   → edits one day; returns the recomputed range
//                   body: { book, config: { prices?, opening?, lineGroupId? } }  → updates the book's config
//                   body: { book, day, send: true }                             → pushes the closing text to the book's LINE group
// Signed-in users only (proxy).
import { NextRequest, NextResponse } from "next/server";
import { linePush } from "@/lib/d90/line";
import { loadConfig } from "@/lib/d90/store";
import { ledgerRange, loadLedgerConfig, safeDay, saveLedgerConfig, updateDay } from "@/lib/ledger/server";
import { bkkToday, closingText, DEFAULT_PRICES, isLedgerBook, type Adjustment, type LedgerConfig, type Prices } from "@/lib/ledger/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const err = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

async function groupsList() {
  const cfg = await loadConfig(true);
  return Object.entries(cfg.groups).filter(([, g]) => g.status === "allowed").map(([id, g]) => ({ id, name: g.name || id }));
}

export async function GET(req: NextRequest) {
  try {
    const book = req.nextUrl.searchParams.get("book") ?? "ARTAO";
    if (!isLedgerBook(book)) return err("unknown book");
    const to = safeDay(req.nextUrl.searchParams.get("to")) ?? bkkToday();
    const [range, groups] = await Promise.all([ledgerRange(book, to), groupsList().catch(() => [])]);
    return NextResponse.json({ ...range, groups }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return err(e instanceof Error ? e.message : "ledger failed", 500);
  }
}

type Body = {
  book?: string;
  day?: string;
  adjustments?: Adjustment[];
  note?: string;
  close?: boolean;
  reopen?: boolean;
  send?: boolean;
  config?: { prices?: Partial<Prices>; opening?: { day: string; amount: number }; lineGroupId?: string };
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body;
    const book = body.book ?? "ARTAO";
    if (!isLedgerBook(book)) return err("unknown book");
    let cfg = await loadLedgerConfig(book);

    if (body.config) {
      const prices: Prices = { ...cfg.prices };
      for (const k of Object.keys(DEFAULT_PRICES) as (keyof Prices)[]) {
        const v = body.config.prices?.[k];
        if (v === undefined) continue;
        if (typeof DEFAULT_PRICES[k] === "boolean") (prices as Record<string, unknown>)[k] = !!v;
        else if (Number.isFinite(Number(v))) (prices as Record<string, unknown>)[k] = Math.max(0, Number(v));
      }
      const opening = body.config.opening && safeDay(body.config.opening.day) && Number.isFinite(Number(body.config.opening.amount))
        ? { day: body.config.opening.day, amount: Number(body.config.opening.amount) }
        : cfg.opening;
      const next: LedgerConfig = { ...cfg, prices, opening, lineGroupId: body.config.lineGroupId === undefined ? cfg.lineGroupId : (body.config.lineGroupId || undefined) };
      await saveLedgerConfig(book, next);
      cfg = next;
    }

    const day = safeDay(body.day);
    if (day && (body.adjustments || typeof body.note === "string" || body.close || body.reopen)) {
      await updateDay(book, day, { adjustments: body.adjustments, note: body.note, close: body.close, reopen: body.reopen }, cfg.prices);
    }

    const to = day && day > bkkToday() ? day : bkkToday();
    const range = await ledgerRange(book, to, cfg);

    let sent = "";
    if (day && body.send) {
      if (!cfg.lineGroupId) return err("ยังไม่ได้เลือกกลุ่ม LINE สำหรับส่งยอด — เลือกในส่วน ⚙️ ก่อน", 409);
      const d = range.days.find((x) => x.day === day);
      if (!d) return err("ไม่พบวันนั้นในบัญชี", 404);
      const r = await linePush(cfg.lineGroupId, closingText(book, d));
      if (!r.ok) return err(r.status === 429 ? "โควตาข้อความ LINE ของเดือนนี้หมดแล้ว" : `LINE ส่งไม่สำเร็จ (${r.status}) ${r.error}`, 502);
      sent = cfg.lineGroupId;
    }

    const groups = await groupsList().catch(() => []);
    return NextResponse.json({ ...range, groups, sent }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return err(e instanceof Error ? e.message : "ledger failed", 500);
  }
}
