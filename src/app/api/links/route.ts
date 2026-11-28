// GET  /api/links             → { items }
// POST /api/links { item }    → add / change one link
// POST /api/links { delete }  → remove by id
import { NextRequest, NextResponse } from "next/server";
import { listLinks, removeLink, saveLink, type LinkItem } from "@/lib/links/store";

export const runtime = "nodejs";
const s = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

export async function GET() {
  return NextResponse.json({ items: await listLinks() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { item?: Partial<LinkItem>; delete?: string };
    if (body.delete) { await removeLink(s(body.delete, 60)); return NextResponse.json({ ok: true }); }
    const it = body.item;
    if (!it || !s(it.title)) return NextResponse.json({ error: "ต้องมีชื่อรายการ" }, { status: 400 });
    const url = s(it.url, 500);
    if (url && !/^https?:\/\//i.test(url)) return NextResponse.json({ error: "ลิงก์ต้องขึ้นต้นด้วย https://" }, { status: 400 });
    const item: LinkItem = {
      id: s(it.id, 60) || `l-${Date.now().toString(36)}`, group: s(it.group, 60) || "อื่น ๆ",
      title: s(it.title), titleZh: s(it.titleZh), titleEn: s(it.titleEn), url, langs: s(it.langs, 30), note: s(it.note, 300),
      pinned: !!it.pinned, todo: !url,
    };
    return NextResponse.json({ item: await saveLink(item) }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "links failed" }, { status: 500 });
  }
}
