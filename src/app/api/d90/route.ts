// 90-day report board API (signed-in users only; the proxy gates this route)
// GET  /api/d90                  → { items, groups, lineReady }
// POST /api/d90  body:
//   { action: "update", id, patch }        edit one item (name, cn, passportNo, kind, nextDue, linkTo, done, note)
//   { action: "delete", id }               remove one item and its picture
//   { action: "reread", id }               run the AI on the stored picture again
//   { action: "clearDay", day }            remove EVERYTHING received on one Bangkok day (YYYY-MM-DD) — for test runs
//   { action: "group", groupId, allow }    allow / remove a LINE group
import { NextRequest, NextResponse } from "next/server";
import { blobDeleteByPath, blobGetByPath } from "@/lib/blob";
import { readD90Image, sniffImageMime } from "@/lib/d90/ocr";
import { loadConfig, loadItems, mutateItems, saveConfig } from "@/lib/d90/store";
import { bkkDay, type D90Item, type D90Kind } from "@/lib/d90/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const noStore = { headers: { "Cache-Control": "no-store" } };
const fail = (e: unknown, status = 500) => NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status });

export async function GET() {
  try {
    const [items, cfg] = await Promise.all([loadItems(), loadConfig(true)]);
    const lineReady = !!process.env.LINE_CHANNEL_SECRET && !!process.env.LINE_CHANNEL_ACCESS_TOKEN;
    return NextResponse.json({ items, groups: cfg.groups, lineReady }, noStore);
  } catch (e) {
    return fail(e);
  }
}

type Patch = Partial<Pick<D90Item, "name" | "cn" | "passportNo" | "kind" | "nextDue" | "linkTo" | "old" | "done" | "note">>;
type Body =
  | { action: "update"; id: string; patch: Patch }
  | { action: "delete"; id: string }
  | { action: "reread"; id: string }
  | { action: "clearDay"; day: string }
  | { action: "group"; groupId: string; allow: boolean; target?: { ns: string; office: string } | null };

const KINDS: D90Kind[] = ["passport", "slip", "other"];

function cleanPatch(p: Patch): Patch {
  const out: Patch = {};
  if (typeof p.name === "string") out.name = p.name.toUpperCase().replace(/\s+/g, " ").trim().slice(0, 80);
  if (typeof p.cn === "string") out.cn = p.cn.replace(/\s+/g, "").slice(0, 20);
  if (typeof p.passportNo === "string") out.passportNo = p.passportNo.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
  if (typeof p.kind === "string" && KINDS.includes(p.kind)) out.kind = p.kind;
  if (typeof p.nextDue === "string" && (p.nextDue === "" || /^\d{2}\/\d{2}\/\d{4}$/.test(p.nextDue))) out.nextDue = p.nextDue;
  if (typeof p.linkTo === "string") out.linkTo = p.linkTo.slice(0, 40);
  if (typeof p.done === "boolean") out.done = p.done;
  if (typeof p.old === "boolean") out.old = p.old;
  if (typeof p.note === "string") out.note = p.note.slice(0, 200);
  return out;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try { body = (await req.json()) as Body; } catch { return fail("bad JSON", 400); }
  try {
    if (body.action === "group") {
      const cfg = await loadConfig(true);
      const g = cfg.groups[body.groupId];
      if (!g) return fail("unknown group", 404);
      if (body.allow) {
        g.status = "allowed";
        // where the pictures go: 90-day board (no target) or a day board for one office
        const t = body.target as { ns?: string; office?: string } | null | undefined;
        if (t === null) delete g.target;
        else if (t && (t.ns === "days" || t.ns === "run") && typeof t.office === "string" && /^[A-Z][A-Z0-9_]+$/.test(t.office)) g.target = { ns: t.ns, office: t.office };
      } else delete cfg.groups[body.groupId];
      await saveConfig(cfg);
      return NextResponse.json({ ok: true, groups: cfg.groups }, noStore);
    }

    if (body.action === "update") {
      const patch = cleanPatch(body.patch ?? {});
      const id = body.id;
      const items = await mutateItems((all) => all.map((i) => (i.id === id ? { ...i, ...patch } : i)));
      return NextResponse.json({ ok: true, items }, noStore);
    }

    if (body.action === "delete") {
      const id = body.id;
      let img = "";
      const items = await mutateItems((all) => {
        img = all.find((i) => i.id === id)?.img ?? "";
        // slips pointing at a deleted passport go back to automatic matching
        return all.filter((i) => i.id !== id).map((i) => (i.linkTo === id ? { ...i, linkTo: undefined } : i));
      });
      if (img) await blobDeleteByPath([img]).catch(() => undefined);
      return NextResponse.json({ ok: true, items }, noStore);
    }

    if (body.action === "clearDay") {
      const day = body.day;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day ?? "")) return fail("day must be YYYY-MM-DD", 400);
      const imgs: string[] = [];
      const removed = new Set<string>();
      const items = await mutateItems((all) => {
        for (const i of all) if (bkkDay(i.ts) === day) { removed.add(i.id); if (i.img) imgs.push(i.img); }
        // anything still pointing at a removed passport goes back to automatic matching
        return all.filter((i) => !removed.has(i.id)).map((i) => (i.linkTo && removed.has(i.linkTo) ? { ...i, linkTo: undefined } : i));
      });
      if (imgs.length) await blobDeleteByPath(imgs).catch(() => undefined);
      return NextResponse.json({ ok: true, items, cleared: removed.size }, noStore);
    }

    if (body.action === "reread") {
      const id = body.id;
      const target = (await loadItems()).find((i) => i.id === id);
      if (!target) return fail("not found", 404);
      const r = await blobGetByPath(target.img);
      if (!r || !r.ok) return fail("picture not found", 404);
      const bytes = await r.arrayBuffer();
      const read = await readD90Image(bytes, sniffImageMime(new Uint8Array(bytes.slice(0, 16))));
      const items = await mutateItems((all) => all.map((i) => (i.id === id ? { ...i, ...read, note: undefined } : i)));
      return NextResponse.json({ ok: true, items }, noStore);
    }

    return fail("unknown action", 400);
  } catch (e) {
    return fail(e);
  }
}
