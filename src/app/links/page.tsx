"use client";

// =============================================================
// /links — 🔗 ลิงก์ส่งลูกค้า
// =============================================================
// The one list of every page we send to customers (they live in separate small
// sites): find it by name, copy the link alone or with its name in Thai /
// Chinese / English, or show a QR at the counter. The second list is the
// services that still have no page to send.

import { useEffect, useMemo, useState } from "react";
import { LINK_GROUPS, type LinkItem } from "@/lib/links/store";

const inp = "w-full min-w-0 rounded-xl border-2 border-amber-100 bg-white px-3 py-2 text-sm font-semibold text-slate-800";
const chip = "rounded-full border-2 px-3 py-1 text-sm font-bold";
const blank = (): LinkItem => ({ id: "", group: LINK_GROUPS[0], title: "", titleZh: "", titleEn: "", url: "", langs: "", note: "", pinned: false });
const short = (u: string) => u.replace(/^https?:\/\//, "").replace(/\/$/, "");
const qrSrc = (u: string) => `https://api.qrserver.com/v1/create-qr-code/?size=420x420&margin=12&data=${encodeURIComponent(u)}`;

export default function LinksPage() {
  const [items, setItems] = useState<LinkItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<LinkItem | null>(null);
  const [qr, setQr] = useState<LinkItem | null>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [fallback, setFallback] = useState("");
  const [delArmed, setDelArmed] = useState(false);

  async function load() {
    try {
      const r = await fetch("/api/links", { cache: "no-store" });
      const j = (await r.json()) as { items?: LinkItem[]; error?: string };
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setItems(j.items ?? []); setError("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setLoaded(true);
  }
  useEffect(() => { void load(); }, []);

  const say = (t: string) => { setToast(t); setTimeout(() => setToast(""), 3000); };
  async function copy(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); setFallback(""); say(`คัดลอก${what}แล้ว`); }
    catch { setFallback(text); say("คัดลอกอัตโนมัติไม่ได้ — กดค้างที่ข้อความด้านบนแล้วเลือกคัดลอก"); }
  }
  async function post(body: unknown): Promise<boolean> {
    try {
      const r = await fetch("/api/links", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setError(""); await load(); return true;
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
  }
  async function save() { if (edit && (await post({ item: edit }))) { setEdit(null); say("บันทึกแล้ว"); } }
  async function remove() {
    if (!edit?.id) return;
    if (!delArmed) { setDelArmed(true); setTimeout(() => setDelArmed(false), 4000); return; }
    setDelArmed(false);
    if (await post({ delete: edit.id })) { setEdit(null); say("ลบแล้ว"); }
  }
  const togglePin = (it: LinkItem) => void post({ item: { ...it, pinned: !it.pinned } });

  const hit = (it: LinkItem) => { const k = q.trim().toLowerCase(); return !k || [it.title, it.titleZh, it.titleEn, it.group, it.url, it.note].some((x) => (x ?? "").toLowerCase().includes(k)); };
  const live = useMemo(() => items.filter((it) => !it.todo && it.url), [items]);
  const todo = useMemo(() => items.filter((it) => it.todo || !it.url), [items]);
  const pinned = live.filter((it) => it.pinned && hit(it));
  const groups = useMemo(() => { const names = [...LINK_GROUPS as readonly string[]]; for (const it of items) if (!names.includes(it.group)) names.push(it.group); return names; }, [items]);

  const row = (it: LinkItem) => (
    <div key={it.id} className="rounded-2xl border-2 border-amber-100 bg-white p-3">
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => togglePin(it)} title={it.pinned ? "เลิกปักหมุด" : "ปักหมุด"} aria-pressed={!!it.pinned} className={`flex-none text-xl leading-none ${it.pinned ? "" : "opacity-25"}`}>📌</button>
        <div className="min-w-0 flex-1">
          <div className="font-bold leading-snug text-slate-900" style={{ overflowWrap: "anywhere" }}>{it.title}{it.langs && <span className="ml-1.5 whitespace-nowrap rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-700">{it.langs}</span>}</div>
          {it.titleZh && <div className="text-sm text-slate-500" style={{ overflowWrap: "anywhere" }}>{it.titleZh}</div>}
          <a href={it.url} target="_blank" rel="noreferrer" className="block truncate text-sm text-sky-600 underline">{short(it.url)}</a>
          {it.note && <div className="mt-0.5 text-xs text-amber-700">{it.note}</div>}
        </div>
        <button type="button" onClick={() => { setEdit(it); setDelArmed(false); }} className="flex-none text-sm font-semibold text-slate-400 underline">แก้ไข</button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" className={`${chip} border-amber-400 bg-amber-400 text-white`} onClick={() => void copy(it.url, "ลิงก์")}>คัดลอกลิงก์</button>
        <button type="button" className={`${chip} border-pink-200 bg-pink-50 text-pink-600`} onClick={() => void copy(`${it.title}\n${it.url}`, "ข้อความไทย")}>+ ชื่อไทย</button>
        {it.titleZh && <button type="button" className={`${chip} border-emerald-200 bg-emerald-50 text-emerald-700`} onClick={() => void copy(`${it.titleZh}\n${it.url}`, "ข้อความจีน")}>+ 中文</button>}
        {it.titleEn && <button type="button" className={`${chip} border-sky-200 bg-sky-50 text-sky-700`} onClick={() => void copy(`${it.titleEn}\n${it.url}`, "ข้อความอังกฤษ")}>+ English</button>}
        <button type="button" className={`${chip} border-slate-200 bg-white text-slate-700`} onClick={() => setQr(it)}>QR</button>
      </div>
    </div>
  );

  return (
    <main className="mx-auto max-w-3xl p-3 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 sm:text-2xl">🔗 ลิงก์ส่งลูกค้า</h1>
          <p className="text-sm text-slate-500">ทุกหน้าที่ใช้ส่งลูกค้า รวมไว้ที่เดียว — มี {live.length} ลิงก์ · ยังไม่มีหน้า {todo.length} เรื่อง</p>
        </div>
        <button type="button" className={`${chip} border-amber-400 bg-amber-400 text-white`} onClick={() => { setEdit(blank()); setDelArmed(false); }}>+ เพิ่มลิงก์</button>
      </div>
      <input id="links-q" className={`${inp} mt-3`} placeholder="ค้นหา เช่น เกษียณ, DTV, non-b, 清莱" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="sticky top-0 z-10 min-h-6 py-1 text-center text-sm font-bold text-emerald-600" role="status">{toast}</div>
      {fallback && <textarea readOnly aria-label="ข้อความสำหรับคัดลอก" className="mb-2 h-20 w-full rounded-xl border-2 border-amber-100 p-2 text-sm" value={fallback} onFocus={(e) => e.currentTarget.select()} />}
      {error && <div className="mb-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{error}</div>}
      {!loaded && <div className="py-10 text-center text-slate-500">กำลังโหลด…</div>}

      {pinned.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-1.5 text-sm font-extrabold text-amber-700">📌 ใช้บ่อย</h2>
          <div className="flex flex-col gap-2">{pinned.map(row)}</div>
        </section>
      )}
      {groups.map((g) => {
        const list = live.filter((it) => it.group === g && hit(it));
        if (!list.length) return null;
        return (
          <section key={g} className="mb-4">
            <h2 className="mb-1.5 text-sm font-extrabold text-slate-600">{g} <span className="font-semibold text-slate-400">({list.length})</span></h2>
            <div className="flex flex-col gap-2">{list.map(row)}</div>
          </section>
        );
      })}
      {loaded && !live.some(hit) && <div className="py-6 text-center text-slate-500">ไม่พบลิงก์ที่ค้นหา</div>}

      {todo.some(hit) && (
        <section className="mt-6 rounded-2xl border-2 border-dashed border-pink-200 bg-pink-50/60 p-3">
          <h2 className="text-base font-extrabold text-pink-600">ยังไม่มีหน้าไว้ส่งลูกค้า ({todo.length})</h2>
          <p className="text-xs text-slate-500">บริการที่ลูกค้าถามบ่อยแต่ยังไม่มีลิงก์ — ทำหน้าเสร็จแล้วกด "ใส่ลิงก์" รายการจะย้ายขึ้นไปอยู่ในหมวดด้านบน</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {todo.filter(hit).map((it) => (
              <li key={it.id} className="flex items-start gap-2 rounded-xl bg-white p-2.5">
                <span className="mt-0.5 flex-none rounded-full bg-pink-100 px-2 py-0.5 text-xs font-bold text-pink-600">{it.group}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold leading-snug text-slate-800" style={{ overflowWrap: "anywhere" }}>{it.title}</div>
                  {it.note && <div className="text-xs text-amber-700">{it.note}</div>}
                </div>
                <button type="button" className="flex-none text-sm font-bold text-sky-600 underline" onClick={() => { setEdit(it); setDelArmed(false); }}>ใส่ลิงก์</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* add / edit */}
      {edit && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3 sm:items-center" onClick={() => setEdit(null)}>
          <div className="max-h-full w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-extrabold text-slate-900">{edit.id ? "แก้ไขลิงก์" : "เพิ่มลิงก์"}</h2>
            <div className="mt-2 grid grid-cols-1 gap-2">
              <label className="text-xs font-bold text-slate-500">ชื่อ (ไทย)<input id="link-title" className={inp} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></label>
              <label className="text-xs font-bold text-slate-500">ลิงก์ (เว้นว่าง = ยังไม่มีหน้า)<input id="link-url" className={inp} value={edit.url} onChange={(e) => setEdit({ ...edit, url: e.target.value.trim() })} placeholder="https://" inputMode="url" /></label>
              <label className="text-xs font-bold text-slate-500">หมวด<select id="link-group" className={inp} value={edit.group} onChange={(e) => setEdit({ ...edit, group: e.target.value })}>{groups.map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
              <label className="text-xs font-bold text-slate-500">ชื่อจีน 中文<input id="link-zh" className={inp} value={edit.titleZh ?? ""} onChange={(e) => setEdit({ ...edit, titleZh: e.target.value })} /></label>
              <label className="text-xs font-bold text-slate-500">ชื่ออังกฤษ<input id="link-en" className={inp} value={edit.titleEn ?? ""} onChange={(e) => setEdit({ ...edit, titleEn: e.target.value })} /></label>
              <label className="text-xs font-bold text-slate-500">ภาษาที่หน้านั้นมี<input id="link-langs" className={inp} value={edit.langs ?? ""} onChange={(e) => setEdit({ ...edit, langs: e.target.value })} placeholder="TH/EN/CN" /></label>
              <label className="text-xs font-bold text-slate-500">โน้ต (เห็นเฉพาะเรา)<input id="link-note" className={inp} value={edit.note ?? ""} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></label>
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700"><input id="link-pin" type="checkbox" className="h-5 w-5 accent-amber-400" checked={!!edit.pinned} onChange={(e) => setEdit({ ...edit, pinned: e.target.checked })} />📌 ปักหมุดไว้บนสุด</label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" className={`${chip} border-amber-400 bg-amber-400 text-white`} onClick={() => void save()}>บันทึก</button>
              <button type="button" className={`${chip} border-slate-200 bg-white text-slate-600`} onClick={() => setEdit(null)}>ยกเลิก</button>
              {edit.id && <button type="button" className={`${chip} ml-auto border-pink-300 bg-white text-pink-600`} onClick={() => void remove()}>{delArmed ? "กดอีกครั้งเพื่อลบ" : "ลบ"}</button>}
            </div>
          </div>
        </div>
      )}

      {/* QR for the counter */}
      {qr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setQr(null)}>
          <div className="w-full max-w-sm rounded-2xl bg-white p-4 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="font-extrabold text-slate-900">{qr.title}</div>
            {qr.titleZh && <div className="text-sm text-slate-500">{qr.titleZh}</div>}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc(qr.url)} alt={`QR ${qr.title}`} width={420} height={420} className="mx-auto mt-2 h-auto w-full max-w-[300px]" />
            <div className="mt-1 break-all text-xs text-slate-500">{short(qr.url)}</div>
            <button type="button" className={`${chip} mt-3 border-slate-200 bg-white text-slate-600`} onClick={() => setQr(null)}>ปิด</button>
          </div>
        </div>
      )}
    </main>
  );
}
