"use client";

// =============================================================
// /d90 — 📥 บอร์ดรายงานตัว 90 วัน
// =============================================================
// Fed by the LINE "กล่องรับงาน" group (see /api/line/webhook): every passport
// page forwarded there opens a case, every receipt slip closes one. Nothing
// is typed — this page is for finding a customer fast when they chase the
// job, seeing who is still waiting, and fixing the few pictures the AI got wrong.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  bkkDay, bkkTime, buildCases, customerMsgZh, dayLabelTh, daysWaiting, isOpen, nameTokens, pendingListZh, ppKey, searchCases,
  type D90Case, type D90Group, type D90Item,
} from "@/lib/d90/types";

type Tab = "open" | "done" | "slips" | "loose";
type Data = { items: D90Item[]; groups: Record<string, D90Group>; lineReady: boolean };

const fileUrl = (path: string) => `/api/d90/file?path=${encodeURIComponent(path)}`;

function ThumbBase({ it, size = 64, onZoom }: { it: D90Item; size?: number; onZoom: (path: string) => void }) {
  return (
    <button type="button" onClick={() => onZoom(it.img)} className="shrink-0 overflow-hidden rounded-xl border border-white shadow-sm ring-1 ring-slate-200" style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={fileUrl(it.img)} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </button>
  );
}

const TONES = {
  slate: "border-slate-200 text-slate-600",
  pink: "border-pink-200 text-pink-600 bg-pink-50",
  sky: "border-sky-200 text-sky-700 bg-sky-50",
  emerald: "border-emerald-200 text-emerald-700 bg-emerald-50",
  rose: "border-rose-200 text-rose-600",
};

function BtnBase({ onClick, children, tone = "slate", disabled }: { onClick: () => void; children: ReactNode; tone?: keyof typeof TONES; disabled: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={`rounded-full border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${TONES[tone]}`}>{children}</button>;
}

export default function D90Page() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [tab, setTab] = useState<Tab>("open");
  const [q, setQ] = useState("");
  const [zoom, setZoom] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/d90", { cache: "no-store" });
      const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j as Data);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }, []);

  useEffect(() => {
    void load();
    const onShow = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [load]);

  async function post(body: Record<string, unknown>, okMsg = "") {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/d90", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData((d) => (d ? { ...d, items: (j.items as D90Item[] | undefined) ?? d.items, groups: (j.groups as Record<string, D90Group> | undefined) ?? d.groups } : d));
      if (okMsg) flash(okMsg);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }
  function flash(msg: string) { setStatus(msg); window.setTimeout(() => setStatus(""), 2500); }

  const update = (id: string, patch: Partial<D90Item>, okMsg = "บันทึกแล้ว") => post({ action: "update", id, patch }, okMsg);
  function editName(it: D90Item) {
    const v = window.prompt("ชื่อ (นามสกุลขึ้นก่อน)", it.name);
    if (v !== null && v.trim() !== it.name) void update(it.id, { name: v });
  }
  function editCn(it: D90Item) {
    const v = window.prompt("ชื่อภาษาจีน 中文姓名", it.cn ?? "");
    if (v !== null && v.trim() !== (it.cn ?? "")) void update(it.id, { cn: v });
  }
  async function copyText(text: string, okMsg: string) {
    try { await navigator.clipboard.writeText(text); flash(okMsg); }
    catch { window.prompt("คัดลอกข้อความนี้", text); }
  }
  function editPp(it: D90Item) {
    const v = window.prompt("เลข passport", it.passportNo);
    if (v !== null && v.trim() !== it.passportNo) void update(it.id, { passportNo: v });
  }
  function editDue(it: D90Item) {
    const v = window.prompt("วันรายงานตัวครั้งถัดไป (วว/ดด/ปปปป ค.ศ.)", it.nextDue);
    if (v !== null && v.trim() !== it.nextDue) void update(it.id, { nextDue: v.trim() });
  }
  function remove(it: D90Item) {
    if (window.confirm(`ลบรูปนี้ออกจากบอร์ด?${it.name ? `\n${it.name}` : ""}`)) void post({ action: "delete", id: it.id }, "ลบแล้ว");
  }

  const board = useMemo(() => buildCases(data?.items ?? []), [data]);
  const now = Date.now();
  const openCases = board.cases.filter(isOpen);
  const doneCases = board.cases.filter((c) => !isOpen(c));

  const zhHits = useMemo(() => (/[\u3400-\u9fff]/.test(q) ? new Set(searchCases(board, q).map((c) => c.passport.id)) : null), [board, q]);
  const match = (c: D90Case) => {
    if (zhHits) return zhHits.has(c.passport.id);
    const tokens = nameTokens(q), pp = ppKey(q);
    if (!tokens.length && !pp) return true;
    const hay = nameTokens(`${c.passport.name} ${c.slip?.name ?? ""}`).join(" ");
    return (tokens.length > 0 && tokens.every((t) => hay.includes(t))) || (pp.length >= 3 && ppKey(c.passport.passportNo).includes(pp));
  };
  // searching looks through everything, whatever tab is open
  const searching = q.trim().length > 0;
  const shownCases = (searching ? board.cases : tab === "open" ? openCases : tab === "done" ? doneCases : []).filter(match);
  const byDay = (() => {
    const m = new Map<string, D90Case[]>();
    for (const c of shownCases) { const k = bkkDay(c.passport.ts); m.set(k, [...(m.get(k) ?? []), c]); }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  })();

  const groups = Object.entries(data?.groups ?? {});
  const pendingGroups = groups.filter(([, g]) => g.status === "pending");
  const allowedGroups = groups.filter(([, g]) => g.status === "allowed");

  const copyPending = () => copyText(pendingListZh(board), "คัดลอกรายการค้างแล้ว");

  return (
    <main className="mx-auto w-full max-w-3xl px-3 pb-24 pt-4 sm:px-6">
      <div className="rounded-3xl p-5 text-slate-800 shadow-sm" style={{ background: "linear-gradient(135deg,#ffd6e8 0%,#d9e8ff 55%,#d3f8e2 100%)" }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold">📥 รายงานตัว 90 วัน</h1>
            <p className="mt-0.5 text-xs text-slate-600">ส่งรูปเข้ากลุ่ม “กล่องรับงาน” — บอร์ดนี้อ่านและจับคู่ให้เอง</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={busy} className="rounded-full bg-white/80 px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm disabled:opacity-50">{busy ? "…" : "🔄 รีเฟรช"}</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-white/80 px-3 py-1 font-semibold text-pink-600">⏳ รอใบ {openCases.length}</span>
          <span className="rounded-full bg-white/80 px-3 py-1 font-semibold text-emerald-600">✅ เสร็จ {doneCases.length}</span>
          {board.orphanSlips.length > 0 && <span className="rounded-full bg-white/80 px-3 py-1 font-semibold text-amber-600">🧾 ใบยังไม่จับคู่ {board.orphanSlips.length}</span>}
        </div>
      </div>

      {error && <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p>}
      {status && <p className="fixed bottom-5 left-1/2 z-40 -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">{status}</p>}

      {data && !data.lineReady && (
        <p className="mt-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">ยังไม่ได้ตั้งค่า LINE: เพิ่ม <b>LINE_CHANNEL_SECRET</b> และ <b>LINE_CHANNEL_ACCESS_TOKEN</b> ใน Vercel แล้ว Redeploy</p>
      )}
      {pendingGroups.map(([id, g]) => (
        <div key={id} className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <span>บอทถูกเชิญเข้ากลุ่ม <b>{g.name || "(ไม่ทราบชื่อ)"}</b> — ให้กลุ่มนี้เป็นกล่องรับงานไหม?</span>
          <span className="flex gap-2">
            <BtnBase disabled={busy} tone="emerald" onClick={() => void post({ action: "group", groupId: id, allow: true }, "อนุญาตแล้ว — ส่งรูปเข้ากลุ่มได้เลย")}>✅ อนุญาตกลุ่มนี้</BtnBase>
            <BtnBase disabled={busy} tone="rose" onClick={() => void post({ action: "group", groupId: id, allow: false })}>ไม่ใช่</BtnBase>
          </span>
        </div>
      ))}
      {data && data.lineReady && groups.length === 0 && (
        <p className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">ยังไม่มีกลุ่ม: เชิญบอทเข้ากลุ่ม “กล่องรับงาน” ใน LINE แล้วกลับมากดรีเฟรชหน้านี้</p>
      )}

      <div className="mt-4 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="🔍 ค้นชื่อ (อังกฤษ / 中文) หรือ เลข passport" className="w-full rounded-full border border-slate-200 bg-white px-4 py-2.5 text-base outline-none focus:border-pink-300" />
        {q && <button type="button" onClick={() => setQ("")} className="rounded-full border border-slate-200 bg-white px-3 text-sm text-slate-500">ล้าง</button>}
      </div>

      {!searching && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {([["open", `⏳ รอใบ (${openCases.length})`], ["done", `✅ เสร็จแล้ว (${doneCases.length})`], ["slips", `🧾 ใบไม่จับคู่ (${board.orphanSlips.length})`], ["loose", `🖼 รูปอื่น (${board.loose.length})`]] as [Tab, string][]).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-full px-3 py-1.5 font-medium ${tab === k ? "bg-pink-500 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600"}`}>{label}</button>
          ))}
          {tab === "open" && openCases.length > 0 && <button type="button" onClick={() => void copyPending()} className="ml-auto rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 font-medium text-sky-700">📋 คัดลอกรายการค้าง (中文)</button>}
        </div>
      )}

      {!data && !error && <p className="mt-8 text-center text-sm text-slate-400">กำลังโหลด…</p>}

      {(searching || tab === "open" || tab === "done") && (
        <>
          {data && shownCases.length === 0 && <p className="mt-8 text-center text-sm text-slate-400">{searching ? `ไม่พบ “${q}”` : tab === "open" ? "ไม่มีงานค้าง 🎉" : "ยังไม่มีงานที่เสร็จ"}</p>}
          {byDay.map(([day, list]) => (
            <section key={day} className="mt-5">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-500">
                <span className="rounded-full bg-violet-100 px-3 py-0.5 text-violet-700">รับงาน {dayLabelTh(day)}</span>
                <span>{list.length} คน</span>
              </h2>
              <div className="space-y-2">
                {list.map((c) => {
                  const p = c.passport;
                  const waited = daysWaiting(p.ts, now);
                  return (
                    <div key={p.id} className={`rounded-2xl border bg-white p-3 shadow-sm ${c.slip ? "border-emerald-200" : p.done ? "border-slate-200" : waited >= 7 ? "border-rose-300" : "border-pink-200"}`}>
                      <div className="flex gap-3">
                        <ThumbBase onZoom={setZoom} it={p} size={72} />
                        <div className="min-w-0 flex-1">
                          <button type="button" onClick={() => editName(p)} className="block max-w-full truncate text-left text-base font-bold text-slate-800">{p.name || "⚠️ อ่านชื่อไม่ออก — แตะเพื่อใส่ชื่อ"}</button>
                          <button type="button" onClick={() => editCn(p)} className={`block text-left text-base ${p.cn ? "font-semibold text-slate-700" : "text-xs text-slate-400"}`}>{p.cn || "+ 中文名"}</button>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                            <button type="button" onClick={() => editPp(p)} className="font-mono">{p.passportNo || "+ เลข passport"}</button>
                            {p.nationality && <span>{p.nationality}</span>}
                            <span>{bkkTime(p.ts)} น.</span>
                          </div>
                          <div className="mt-1.5 text-sm">
                            {c.slip ? (
                              <span className="font-semibold text-emerald-600">✅ ได้ใบแล้ว {dayLabelTh(bkkDay(c.slip.ts))}{c.how === "fuzzy" && <span className="ml-1 font-normal text-amber-600">(ชื่อใกล้เคียง — ตรวจดู)</span>}</span>
                            ) : p.done ? (
                              <span className="font-semibold text-slate-500">☑️ ปิดงานเอง</span>
                            ) : (
                              <span className={`font-semibold ${waited >= 7 ? "text-rose-600" : "text-pink-600"}`}>⏳ รอใบ{waited > 0 ? ` · ${waited} วันแล้ว` : " · วันนี้"}</span>
                            )}
                          </div>
                        </div>
                        {c.slip && (
                          <div className="flex flex-col items-center gap-1">
                            <ThumbBase onZoom={setZoom} it={c.slip} size={72} />
                            <button type="button" onClick={() => editDue(c.slip!)} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">{c.slip.nextDue ? `ครั้งถัดไป ${c.slip.nextDue}` : "+ วันครั้งถัดไป"}</button>
                          </div>
                        )}
                      </div>
                      {c.pages.length > 0 && (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          {c.pages.map((o) => (
                            <span key={o.id} className="flex items-center gap-1">
                              <ThumbBase onZoom={setZoom} it={o} size={44} />
                              {o.kind === "slip" && (
                                <button type="button" disabled={busy} onClick={() => { if (window.confirm("ใบนี้คือใบใหม่ (ผลงานที่เจ้าหน้าที่ส่งกลับ) ใช่ไหม?\nกดตกลงเพื่อใช้ใบนี้ปิดงาน")) void update(o.id, { old: false }); }} className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">📎 ใบเก่า{o.nextDue ? ` ${o.nextDue}` : ""}</button>
                              )}
                            </span>
                          ))}
                        </div>
                      )}
                      {p.note && <p className="mt-2 text-xs text-amber-700">📝 {p.note}</p>}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <BtnBase disabled={busy} onClick={() => { const v = window.prompt("โน้ต (เช่น 性别错)", p.note ?? ""); if (v !== null) void update(p.id, { note: v }); }}>📝 โน้ต</BtnBase>
                        {!c.slip && <BtnBase disabled={busy} tone={p.done ? "pink" : "slate"} onClick={() => void update(p.id, { done: !p.done })}>{p.done ? "↩️ เปิดงานใหม่" : "☑️ ปิดงานเอง"}</BtnBase>}
                        {c.slip && <BtnBase disabled={busy} tone="sky" onClick={() => void copyText(customerMsgZh(p.name, p.cn, c.slip!.nextDue), "คัดลอกข้อความแจ้งลูกค้าแล้ว")}>📋 ข้อความแจ้งลูกค้า (中文)</BtnBase>}
                        {c.slip && <BtnBase disabled={busy} onClick={() => void update(c.slip!.id, { old: true }, "ย้ายเป็นใบเก่าแล้ว — งานกลับไปรอใบ")}>📎 นี่คือใบเก่า</BtnBase>}
                        {c.slip && <BtnBase disabled={busy} onClick={() => void update(c.slip!.id, { linkTo: "-" }, "ยกเลิกจับคู่แล้ว")}>✂️ ใบนี้ไม่ใช่ของคนนี้</BtnBase>}
                        <BtnBase disabled={busy} onClick={() => void post({ action: "reread", id: p.id }, "อ่านใหม่แล้ว")}>🔁 อ่านใหม่</BtnBase>
                        <BtnBase disabled={busy} tone="rose" onClick={() => remove(p)}>🗑 ลบ</BtnBase>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </>
      )}

      {!searching && tab === "slips" && (
        <div className="mt-4 space-y-2">
          {board.orphanSlips.length === 0 && <p className="mt-8 text-center text-sm text-slate-400">ทุกใบจับคู่แล้ว 🎉</p>}
          {[...board.orphanSlips].reverse().map((s) => (
            <div key={s.id} className="rounded-2xl border border-amber-200 bg-white p-3 shadow-sm">
              <div className="flex gap-3">
                <ThumbBase onZoom={setZoom} it={s} size={72} />
                <div className="min-w-0 flex-1">
                  <button type="button" onClick={() => editName(s)} className="block max-w-full truncate text-left text-base font-bold text-slate-800">{s.name || "⚠️ อ่านชื่อไม่ออก — แตะเพื่อใส่ชื่อ"}</button>
                  <div className="mt-0.5 text-xs text-slate-500">ใบมาถึง {dayLabelTh(bkkDay(s.ts))} {bkkTime(s.ts)} น.{s.nextDue ? ` · ครั้งถัดไป ${s.nextDue}` : ""}</div>
                  <select disabled={busy} value="" onChange={(e) => { if (e.target.value) void update(s.id, { linkTo: e.target.value }, "จับคู่แล้ว"); }} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-2 py-2 text-sm">
                    <option value="">จับคู่กับงานที่รอใบ…</option>
                    {openCases.map((c) => <option key={c.passport.id} value={c.passport.id}>{c.passport.name || "(ไม่มีชื่อ)"} {c.passport.cn ?? ""} · {dayLabelTh(bkkDay(c.passport.ts))}</option>)}
                  </select>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <BtnBase disabled={busy} onClick={() => void update(s.id, { kind: "passport", linkTo: "" })}>ที่จริงเป็นหน้า passport</BtnBase>
                <BtnBase disabled={busy} onClick={() => void post({ action: "reread", id: s.id }, "อ่านใหม่แล้ว")}>🔁 อ่านใหม่</BtnBase>
                <BtnBase disabled={busy} tone="rose" onClick={() => remove(s)}>🗑 ลบ</BtnBase>
              </div>
            </div>
          ))}
        </div>
      )}

      {!searching && tab === "loose" && (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-slate-400">รูปที่ไม่ใช่หน้า passport หรือใบ 90 วันใบใหม่ และไม่ได้ส่งมาติดกับ passport ของใคร</p>
          {board.loose.length === 0 && <p className="mt-8 text-center text-sm text-slate-400">ไม่มี</p>}
          {[...board.loose].reverse().map((o) => (
            <div key={o.id} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
              <ThumbBase onZoom={setZoom} it={o} size={64} />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-slate-500">{o.kind === "slip" ? `📎 ใบ 90 วันใบเก่า · ${o.name || "ไม่มีชื่อ"}${o.nextDue ? ` · ${o.nextDue}` : ""} · ` : ""}{dayLabelTh(bkkDay(o.ts))} {bkkTime(o.ts)} น.{o.note ? ` · ${o.note}` : ""}</div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <BtnBase disabled={busy} tone="pink" onClick={() => void update(o.id, { kind: "passport" })}>เป็นหน้า passport</BtnBase>
                  <BtnBase disabled={busy} tone="emerald" onClick={() => void update(o.id, { kind: "slip", old: false })}>เป็นใบ 90 วันใบใหม่</BtnBase>
                  <BtnBase disabled={busy} onClick={() => void post({ action: "reread", id: o.id }, "อ่านใหม่แล้ว")}>🔁 อ่านใหม่</BtnBase>
                  <BtnBase disabled={busy} tone="rose" onClick={() => remove(o)}>🗑 ลบ</BtnBase>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {allowedGroups.length > 0 && (
        <p className="mt-10 text-center text-xs text-slate-400">
          กล่องรับงาน: {allowedGroups.map(([id, g], i) => (
            <span key={id}>{i > 0 && " · "}{g.name || "กลุ่ม LINE"} <button type="button" className="underline" onClick={() => { if (window.confirm(`เลิกรับรูปจากกลุ่ม ${g.name || ""}?`)) void post({ action: "group", groupId: id, allow: false }); }}>เลิกใช้</button></span>
          ))}
          <br />ถามบอทในกลุ่มได้: พิมพ์ <b>?ชื่อ</b> เช่น ?li zhong
        </p>
      )}

      {zoom && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/85" onClick={() => setZoom("")}>
          <div className="flex justify-between p-3 text-sm text-white">
            <span>กดค้างที่รูปเพื่อบันทึก / แชร์</span>
            <span className="rounded-full bg-white/20 px-3 py-1">✕ ปิด</span>
          </div>
          <div className="flex min-h-0 flex-1 items-center justify-center p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(zoom)} alt="" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
          </div>
        </div>
      )}
    </main>
  );
}
