"use client";

// =============================================================
// /nonb — ✅ document check for a Non-B 90-day case
// =============================================================
// Taking a case in: tick each paper as complete / missing / not needed, see
// what is still missing at a glance, and copy that list (Thai or Chinese) to
// the customer or the agent. Saved on the server per customer, so the phone at
// the counter and the PC show the same ticks; the page also prints as a sheet.

import { useEffect, useMemo, useRef, useState } from "react";
import { emptyState, NONB90_GROUPS as GROUPS, NONB90_ITEMS as ALL, type CheckItem, type CheckRec, type ItemState } from "@/lib/checklist/nonb90";

const bkkToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const blank = (): CheckRec => ({ id: uid(), name: "", cn: "", co: "", date: bkkToday(), exp: "", items: {} });
const dmy = (d: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : "");
const inp = "w-full min-w-0 rounded-xl border-2 border-sky-100 bg-white px-3 py-2 font-semibold text-slate-800";
const btn = "rounded-xl border-2 border-sky-100 bg-white px-3 py-1.5 text-sm font-bold text-slate-700";
const btnPri = "rounded-xl border-2 border-sky-400 bg-sky-400 px-3 py-1.5 text-sm font-bold text-white";

const stOf = (r: CheckRec, id: string): ItemState => r.items[id] ?? emptyState();
/** Days left on the stamp — the bureau takes the application only with MORE than 15 days left. */
const daysLeft = (exp: string) => (exp ? Math.round((Date.parse(`${exp}T00:00:00Z`) - Date.parse(`${bkkToday()}T00:00:00Z`)) / 86400000) : null);
function counts(r: CheckRec, items: CheckItem[]) {
  const n = { ok: 0, miss: 0, na: 0, wait: 0 };
  for (const it of items) { const s = stOf(r, it.id).s; n[s === "ok" ? "ok" : s === "miss" ? "miss" : s === "na" ? "na" : "wait"]++; }
  return n;
}
const missingSubs = (r: CheckRec, it: CheckItem, zh: boolean) => (it.subs ?? []).filter((_, i) => !stOf(r, it.id).subs[i]).map((x) => x[zh ? 1 : 0]);

/** The message to paste into chat: what is missing (and unchecked); `full` adds the complete and not-needed lists. */
function buildText(c: CheckRec, zh: boolean, full: boolean): string {
  const L: string[] = [];
  const who = [c.name, c.cn].filter(Boolean).join(" ");
  L.push(zh ? "【转换 NON-B 签证 90天】文件核对" : "ตรวจเอกสารเปลี่ยนวีซ่า Non-B 90 วัน");
  if (who) L.push((zh ? "申请人：" : "ลูกค้า: ") + who);
  if (c.co) L.push((zh ? "公司：" : "บริษัท: ") + c.co);
  const d = daysLeft(c.exp);
  if (d !== null) L.push(zh ? (d <= 15 ? `⚠ 停留期只剩 ${d} 天（须超过15天才能递交）` : `停留期剩余 ${d} 天`) : (d <= 15 ? `⚠ วันอนุญาตเหลือ ${d} วัน (ต้องเหลือมากกว่า 15 วัน)` : `วันอนุญาตเหลือ ${d} วัน`));
  const line = (it: CheckItem) => {
    const s = stOf(c, it.id), ms = s.s === "miss" ? missingSubs(c, it, zh) : [];
    const part = ms.length && ms.length < (it.subs ?? []).length ? (zh ? `（缺：${ms.join("、")}）` : ` (ขาด: ${ms.join(", ")})`) : "";
    return `${it.no !== "✓" ? `${it.no}. ` : "• "}${zh ? it.zh : it.th}${it.choice && s.pick ? ` [${s.pick}]` : ""}${part}${s.note ? ` — ${s.note}` : ""}`;
  };
  const by = (k: string) => ALL.filter((it) => stOf(c, it.id).s === k);
  const miss = by("miss"), wait = by(""), ok = by("ok"), na = by("na");
  L.push("");
  if (miss.length) { L.push(zh ? `❌ 还缺 ${miss.length} 项：` : `❌ ยังขาด ${miss.length} รายการ:`); miss.forEach((it) => L.push(line(it))); }
  else L.push(zh ? "✅ 没有缺少的文件" : "✅ ไม่มีรายการที่ขาด");
  if (wait.length) { L.push(""); L.push(zh ? `⏳ 尚未核对 ${wait.length} 项：` : `⏳ ยังไม่ได้ตรวจ ${wait.length} รายการ:`); wait.forEach((it) => L.push(line(it))); }
  if (full) {
    if (ok.length) { L.push(""); L.push(`✅ ครบแล้ว ${ok.length} รายการ:`); ok.forEach((it) => L.push(line(it))); }
    if (na.length) { L.push(""); L.push(`➖ ไม่ต้องใช้ ${na.length} รายการ:`); na.forEach((it) => L.push(line(it))); }
    L.push(""); L.push(`ตรวจเมื่อ ${dmy(c.date || bkkToday())}`);
  }
  return L.join("\n");
}

const LOOK: Record<ItemState["s"], string> = {
  "": "border-amber-300 bg-white",
  ok: "border-emerald-400 bg-emerald-50",
  miss: "border-pink-400 bg-pink-50",
  na: "border-slate-300 bg-slate-50 opacity-80",
};
const MARK: Record<ItemState["s"], string> = { "": "☐", ok: "☑ ครบ", miss: "☒ ขาด", na: "— ไม่ต้องใช้" };

export default function NonBCheckPage() {
  const [list, setList] = useState<CheckRec[]>([]);
  const [curId, setCurId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [fallback, setFallback] = useState("");
  const [delArmed, setDelArmed] = useState(false);
  const dirty = useRef<Map<string, CheckRec>>(new Map());   // records changed since the last save
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/checklist", { cache: "no-store" });
        const j = (await r.json()) as { list?: CheckRec[]; error?: string };
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        const got = j.list ?? [];
        if (got.length) { setList(got); setCurId(got[0].id); } else { const c = blank(); setList([c]); setCurId(c.id); }
      } catch (e) { setError(e instanceof Error ? e.message : String(e)); const c = blank(); setList([c]); setCurId(c.id); }
      setLoaded(true);
    })();
  }, []);

  async function flush() {
    const todo = [...dirty.current.values()]; dirty.current.clear();
    if (!todo.length) return;
    setStatus("กำลังบันทึก…");
    try {
      for (const rec of todo) {
        const r = await fetch("/api/checklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rec }) });
        if (!r.ok) { const j = (await r.json().catch(() => ({}))) as { error?: string }; throw new Error(j.error || `HTTP ${r.status}`); }
      }
      setStatus(dirty.current.size ? "กำลังบันทึก…" : "บันทึกแล้ว ✓"); setError("");
    } catch (e) {
      for (const rec of todo) if (!dirty.current.has(rec.id)) dirty.current.set(rec.id, rec);   // keep for the next try
      setStatus(""); setError(`บันทึกไม่สำเร็จ (${e instanceof Error ? e.message : String(e)}) — จะลองใหม่เมื่อแก้ไขครั้งถัดไป`);
    }
  }
  // leaving the page with unsaved ticks: send them on the way out
  useEffect(() => {
    const out = () => { for (const rec of dirty.current.values()) navigator.sendBeacon?.("/api/checklist", new Blob([JSON.stringify({ rec })], { type: "application/json" })); };
    window.addEventListener("pagehide", out);
    return () => window.removeEventListener("pagehide", out);
  }, []);

  const cur = useMemo(() => list.find((c) => c.id === curId) ?? null, [list, curId]);
  function update(fn: (c: CheckRec) => CheckRec) {
    if (!cur) return;
    const next = fn(cur);
    setList((l) => l.map((c) => (c.id === next.id ? next : c)));
    dirty.current.set(next.id, next);
    setStatus("ยังไม่ได้บันทึก…");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 900);
  }
  const setItem = (id: string, fn: (s: ItemState) => ItemState) => update((c) => ({ ...c, items: { ...c.items, [id]: fn(stOf(c, id)) } }));

  function setSub(it: CheckItem, i: number, on: boolean) {
    setItem(it.id, (s) => {
      const subs = (it.subs ?? []).map((_, k) => (k === i ? on : !!s.subs[k]));
      const all = subs.every(Boolean);
      // every part ticked = complete; un-ticking one takes "ครบ" back
      return { ...s, subs, s: all && s.s !== "na" ? "ok" : !all && s.s === "ok" ? "" : s.s };
    });
  }
  function allOk(items: CheckItem[]) {
    update((c) => {
      const next = { ...c.items };
      for (const it of items) { const s = stOf(c, it.id); if (!s.s) next[it.id] = { ...s, s: "ok", subs: (it.subs ?? []).map(() => true) }; }
      return { ...c, items: next };
    });
  }
  function addNew() { const c = blank(); setList((l) => [c, ...l]); setCurId(c.id); }
  async function removeCur() {
    if (!cur) return;
    if (!delArmed) { setDelArmed(true); setTimeout(() => setDelArmed(false), 4000); return; }
    setDelArmed(false);
    const id = cur.id;
    dirty.current.delete(id);
    const left = list.filter((c) => c.id !== id);
    const next = left.length ? left : [blank()];
    setList(next); setCurId(next[0].id);
    try { await fetch("/api/checklist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: id }) }); setStatus("ลบแล้ว"); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setFallback(""); setToast("คัดลอกแล้ว วางในแชทได้เลย"); }
    catch { setFallback(text); setToast("คัดลอกอัตโนมัติไม่ได้ — กดค้างที่ข้อความด้านล่างแล้วเลือกคัดลอก"); }
    setTimeout(() => setToast(""), 4000);
  }

  if (!loaded || !cur) return <main className="mx-auto max-w-3xl p-5 text-center text-slate-500">กำลังโหลด…</main>;

  const n = counts(cur, ALL), need = ALL.length - n.na;
  const d = daysLeft(cur.exp), blocked = d !== null && d <= 15;
  const verdict = blocked ? "⚠ วันเหลือไม่พอ ยื่นไม่ได้" : n.miss ? `ยังขาด ${n.miss} รายการ` : n.wait ? `ยังไม่ได้ตรวจ ${n.wait} รายการ` : "ครบแล้ว พร้อมยื่น ✓";
  const verdictCls = blocked || n.miss ? "text-pink-600" : n.wait ? "text-amber-700" : "text-emerald-600";
  const miss = ALL.filter((it) => stOf(cur, it.id).s === "miss"), wait = ALL.filter((it) => !stOf(cur, it.id).s);
  const missLine = (it: CheckItem) => {
    const s = stOf(cur, it.id), ms = s.s === "miss" ? missingSubs(cur, it, false) : [];
    return (
      <li key={it.id}><b>{it.no !== "✓" ? `${it.no}. ` : ""}{it.th}</b>{ms.length > 0 && ms.length < (it.subs ?? []).length ? ` — ขาด: ${ms.join(", ")}` : ""}{s.note ? <span className="text-slate-500"> ({s.note})</span> : null}</li>
    );
  };

  return (
    <main className="mx-auto max-w-3xl bg-sky-50/60 p-3 sm:p-5 print:max-w-none print:bg-white print:p-0">
      <h1 className="text-xl font-extrabold text-slate-900 sm:text-2xl">✅ ตรวจเอกสารเปลี่ยนวีซ่าเป็น Non-B 90 วัน</h1>
      <p className="text-sm text-slate-500">ตามรายการของ ตม. (ทำงานในบริษัท / หจก. รหัส B) · 转换 NON-B 签证 90天 文件核对</p>

      {/* score strip — stays in view while ticking */}
      <div className="sticky top-0 z-10 -mx-1 mt-3 bg-sky-50/95 px-1 py-2 print:static print:bg-white">
        <div className="rounded-2xl border-2 border-sky-100 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className={`text-lg font-extrabold ${verdictCls}`}>{verdict}</span>
            <span className="text-sm font-bold text-slate-500">{[cur.name, cur.cn].filter(Boolean).join(" ") || "ยังไม่ใส่ชื่อ"}</span>
          </div>
          <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-100 print:hidden">
            <i className="block h-full bg-emerald-400" style={{ width: `${need ? (n.ok / need) * 100 : 0}%` }} />
            <i className="block h-full bg-pink-400" style={{ width: `${need ? (n.miss / need) * 100 : 0}%` }} />
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2 text-center text-xs font-bold">
            <div className="rounded-xl bg-emerald-100 py-1 text-emerald-800"><b className="block text-xl tabular-nums">{n.ok}/{need}</b>ครบ</div>
            <div className="rounded-xl bg-pink-100 py-1 text-pink-700"><b className="block text-xl tabular-nums">{n.miss}</b>ขาด</div>
            <div className="rounded-xl bg-amber-100 py-1 text-amber-800"><b className="block text-xl tabular-nums">{n.wait}</b>ยังไม่ตรวจ</div>
            <div className="rounded-xl bg-slate-100 py-1 text-slate-600"><b className="block text-xl tabular-nums">{n.na}</b>ไม่ต้องใช้</div>
          </div>
        </div>
      </div>

      {error && <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 print:hidden">{error}</div>}

      {/* customer */}
      <section className="mt-2 rounded-2xl border-2 border-sky-100 bg-white p-3">
        <div className="mb-3 flex flex-wrap items-end gap-2 print:hidden">
          <label className="min-w-0 flex-1 basis-56 text-xs font-bold text-slate-500">ลูกค้าที่บันทึกไว้ ({list.length})
            <select id="nonb-pick" className={inp} value={curId} onChange={(e) => { setCurId(e.target.value); setDelArmed(false); }}>
              {list.map((c) => { const k = counts(c, ALL); return <option key={c.id} value={c.id}>{[c.name, c.cn].filter(Boolean).join(" ") || "(ยังไม่ใส่ชื่อ)"}{c.co ? ` · ${c.co}` : ""}{k.miss ? ` — ขาด ${k.miss}` : k.wait ? "" : " — ครบ"}</option>; })}
            </select>
          </label>
          <button type="button" className={btnPri} onClick={addNew}>+ ลูกค้าใหม่</button>
          <button type="button" className={`${btn} !border-pink-300 text-pink-600`} onClick={() => void removeCur()}>{delArmed ? "กดอีกครั้งเพื่อลบ" : "ลบรายนี้"}</button>
          <button type="button" className={btn} onClick={() => window.print()}>🖨 พิมพ์</button>
          <span className="w-full text-right text-xs font-semibold text-slate-400">{status}</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <label className="text-xs font-bold text-slate-500">ชื่อลูกค้า (นามสกุลก่อน)<input id="nonb-name" className={inp} value={cur.name} onChange={(e) => update((c) => ({ ...c, name: e.target.value.toUpperCase() }))} placeholder="YAN JUN" /></label>
          <label className="text-xs font-bold text-slate-500">ชื่อจีน 中文名<input id="nonb-cn" className={inp} value={cur.cn} onChange={(e) => update((c) => ({ ...c, cn: e.target.value }))} placeholder="严军" /></label>
          <label className="text-xs font-bold text-slate-500 sm:col-span-2">บริษัท / นายจ้าง<input id="nonb-co" className={inp} value={cur.co} onChange={(e) => update((c) => ({ ...c, co: e.target.value }))} placeholder="ชื่อบริษัท" /></label>
          <label className="text-xs font-bold text-slate-500">วันรับงาน<input id="nonb-date" type="date" className={inp} value={cur.date} onChange={(e) => update((c) => ({ ...c, date: e.target.value }))} /></label>
          <label className="text-xs font-bold text-slate-500">อนุญาตให้อยู่ถึงวันที่ (ตราประทับล่าสุด)<input id="nonb-exp" type="date" className={inp} value={cur.exp} onChange={(e) => update((c) => ({ ...c, exp: e.target.value }))} /></label>
        </div>
        <div className={`mt-3 rounded-xl px-3 py-2 text-sm font-bold ${d === null ? "bg-slate-100 text-slate-600" : d <= 15 ? "bg-pink-100 text-pink-700" : "bg-emerald-100 text-emerald-800"}`}>
          {d === null ? "ใส่วันที่อนุญาตให้อยู่ เพื่อเช็คว่าเหลือมากกว่า 15 วันหรือไม่ (เงื่อนไขของ ตม.)"
            : d < 0 ? `อยู่เกินกำหนดแล้ว ${-d} วัน — ยื่นเปลี่ยนวีซ่าประเภทนี้ไม่ได้`
            : d <= 15 ? `เหลือ ${d} วัน — ต้องเหลือมากกว่า 15 วัน ยื่นไม่ได้`
            : `เหลือ ${d} วัน — ยื่นได้ · ต้องยื่นก่อนเหลือ 15 วัน (อีก ${d - 15} วัน)`}
        </div>
      </section>

      {/* the three groups */}
      {GROUPS.map((g) => {
        const k = counts(cur, g.items);
        return (
          <section key={g.id} className="mt-3 rounded-2xl border-2 border-sky-100 bg-white p-3 print:break-inside-auto">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="text-lg font-extrabold text-slate-900">{g.th}</h2><div className="text-sm text-slate-500">{g.zh}</div></div>
              <div className="flex items-center gap-2"><span className="text-sm font-bold text-slate-500">ครบ {k.ok}/{g.items.length - k.na}</span><button type="button" className={`${btn} print:hidden`} onClick={() => allOk(g.items)}>ติ๊กครบทั้งหมวด</button></div>
            </div>
            <div className="flex flex-col gap-2">
              {g.items.map((it) => {
                const s = stOf(cur, it.id);
                return (
                  <div key={it.id} className={`flex flex-col gap-2 rounded-xl border-2 border-l-8 p-2.5 print:break-inside-avoid print:gap-1 print:p-1.5 ${LOOK[s.s]}`}>
                    <div className="flex items-start gap-2.5">
                      <div className="flex h-8 min-w-8 flex-none items-center justify-center rounded-full bg-sky-100 px-1.5 text-sm font-extrabold text-sky-700">{it.no}</div>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold leading-snug text-slate-900" style={{ overflowWrap: "anywhere" }}>{it.th}{it.tag && <span className="ml-1.5 whitespace-nowrap rounded-full bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-700">{it.tag}</span>}</div>
                        <div className="text-sm text-slate-500" style={{ overflowWrap: "anywhere" }}>{it.zh}</div>
                        {it.hint && <div className="mt-1 inline-block rounded-lg bg-amber-100 px-2 py-0.5 text-[13px] text-amber-900">{it.hint}</div>}
                      </div>
                      <div className="hidden flex-none whitespace-nowrap text-sm font-extrabold print:block">{MARK[s.s]}</div>
                    </div>
                    {it.choice && (
                      <div className="flex flex-wrap gap-1.5">
                        {it.choice.map((c) => (
                          <label key={c} className="flex items-center gap-1.5 rounded-full border-2 border-sky-100 bg-white py-1 pl-2 pr-3 text-sm font-semibold">
                            <input type="radio" name={`pick-${it.id}`} id={`pick-${it.id}-${c}`} className="h-5 w-5 accent-emerald-500" checked={s.pick === c} onChange={() => setItem(it.id, (x) => ({ ...x, pick: c }))} />{c}
                          </label>
                        ))}
                      </div>
                    )}
                    {it.subs && (
                      <div className="flex flex-wrap gap-1.5">
                        {it.subs.map((x, i) => (
                          <label key={i} className="flex items-center gap-1.5 rounded-full border-2 border-sky-100 bg-white py-1 pl-2 pr-3 text-sm font-semibold print:border-0 print:py-0">
                            <input type="checkbox" id={`sub-${it.id}-${i}`} className="h-5 w-5 accent-emerald-500" checked={!!s.subs[i]} onChange={(e) => setSub(it, i, e.target.checked)} />{x[0]}
                          </label>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-3 gap-1.5 print:hidden" role="group" aria-label="สถานะ">
                      {([["ok", "✓ ครบ", "border-emerald-500 bg-emerald-500 text-white"], ["miss", "✕ ขาด", "border-pink-500 bg-pink-500 text-white"], ["na", "– ไม่ต้องใช้", "border-slate-400 bg-slate-400 text-white"]] as const).map(([v, label, on]) => (
                        <button key={v} type="button" aria-pressed={s.s === v} onClick={() => setItem(it.id, (x) => ({ ...x, s: x.s === v ? "" : v }))}
                          className={`rounded-xl border-2 px-1 py-2 text-[15px] font-bold ${s.s === v ? on : "border-sky-100 bg-white text-slate-700"}`}>{label}</button>
                      ))}
                    </div>
                    <input id={`note-${it.id}`} className={`w-full rounded-xl border-2 border-dashed border-sky-100 bg-white px-3 py-1.5 text-[15px] ${s.note ? "" : "print:hidden"}`} placeholder="โน้ต เช่น ขาดอะไร / นัดส่งวันไหน" value={s.note} onChange={(e) => setItem(it.id, (x) => ({ ...x, note: e.target.value }))} />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* what is still missing + copy */}
      <section className="mt-3 rounded-2xl border-2 border-sky-100 bg-white p-3 print:break-inside-avoid">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-extrabold text-slate-900">สรุปที่ยังขาด</h2><span className="text-sm font-bold text-emerald-600" role="status">{toast}</span></div>
        {miss.length ? <><div className="mt-1 font-bold text-pink-600">ขาด {miss.length} รายการ</div><ul className="ml-5 list-disc">{miss.map(missLine)}</ul></> : <div className="mt-1 font-bold text-emerald-600">ไม่มีรายการที่ติ๊กว่าขาด</div>}
        {wait.length > 0 && <><div className="mt-2 font-bold text-amber-700">ยังไม่ได้ตรวจ {wait.length} รายการ</div><ul className="ml-5 list-disc">{wait.map(missLine)}</ul></>}
        <div className="mt-3 flex flex-wrap gap-2 print:hidden">
          <button type="button" className={btnPri} onClick={() => void copy(buildText(cur, false, false))}>คัดลอกรายการที่ขาด (ไทย)</button>
          <button type="button" className={btnPri} onClick={() => void copy(buildText(cur, true, false))}>复制缺少的文件 (中文)</button>
          <button type="button" className={btn} onClick={() => void copy(buildText(cur, false, true))}>คัดลอกผลตรวจทั้งหมด</button>
        </div>
        {fallback && <textarea readOnly aria-label="ข้อความสำหรับคัดลอก" className="mt-2 h-40 w-full rounded-xl border-2 border-sky-100 p-2 text-sm print:hidden" value={fallback} onFocus={(e) => e.currentTarget.select()} />}
      </section>
      <p className="mt-3 text-xs text-slate-400 print:hidden">บันทึกอัตโนมัติบนเซิร์ฟเวอร์ เปิดจากมือถือหรือคอมก็เห็นชุดเดียวกัน · รายการอ้างอิงแบบฟอร์ม ตม. ฉบับ Feb 2022</p>
    </main>
  );
}
