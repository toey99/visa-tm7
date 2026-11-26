// GET  /api/checklist              → { list }
// POST /api/checklist { rec }      → upsert one customer's checklist
// POST /api/checklist { delete }   → remove by id
import { NextRequest, NextResponse } from "next/server";
import { NONB90_ITEMS, type CheckRec, type ItemState } from "@/lib/checklist/nonb90";
import { listChecks, removeCheck, saveCheck } from "@/lib/checklist/store";

export const runtime = "nodejs";
const s = (v: unknown, max = 200) => String(v ?? "").slice(0, max);
const day = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : "");

export async function GET() {
  return NextResponse.json({ list: await listChecks() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { rec?: Partial<CheckRec>; delete?: string };
    if (body.delete) { await removeCheck(s(body.delete, 40)); return NextResponse.json({ ok: true }); }
    const r = body.rec;
    if (!r || !s(r.id, 40)) return NextResponse.json({ error: "ไม่มีข้อมูลที่จะบันทึก" }, { status: 400 });
    const items: Record<string, ItemState> = {};
    for (const it of NONB90_ITEMS) {
      const x = (r.items ?? {})[it.id];
      if (!x) continue;
      items[it.id] = {
        s: x.s === "ok" || x.s === "miss" || x.s === "na" ? x.s : "",
        note: s(x.note, 300), pick: s(x.pick, 20),
        subs: (it.subs ?? []).map((_, i) => !!(x.subs ?? [])[i]),
      };
    }
    const rec: CheckRec = { id: s(r.id, 40), name: s(r.name).toUpperCase(), cn: s(r.cn), co: s(r.co), date: day(r.date), exp: day(r.exp), items, createdAt: s(r.createdAt, 40) };
    return NextResponse.json({ rec: await saveCheck(rec) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "checklist failed" }, { status: 500 });
  }
}
