"use client";

// =============================================================
// /slips — 🧾 ห้องสลิปโอน (per agency book)
// =============================================================
// Fed by the LINE slip group (see /api/line/webhook): every transfer slip
// forwarded there lands in the open accounting round. This page is the tidy
// record of each round — pictures, amounts, the "13,000+47,000 = …" line for
// the daily closing note — and the place to fix what the AI got wrong.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SLIP_BOOKS, addDays, bkkTime, byArrival, counted, dayTh, formula, isSlipBook, money, total, totalIn, totalOut, type SlipBookId, type SlipItem } from "@/lib/slips/types";
import SlipSheet from "@/components/SlipSheet";
import { captureNode, downloadBlob } from "@/lib/today/clientTools";

type Data = { book: SlipBookId; day: string; round: string; closed: Record<string, number>; items: SlipItem[] };
const fileUrl = (path: string) => `/api/slips/file?path=${encodeURIComponent(path)}`;

export default function SlipsPage() {
  // which agency's slip room: /slips (อาเต่า) or /slips?book=NUNA
  const [bookState, setBookState] = useState<SlipBookId | null>(null);
  useEffect(() => { const b = new URLSearchParams(window.location.search).get("book"); setBookState(isSlipBook(b) ? b : "ARTAO"); }, []);
  const BOOK: SlipBookId = bookState ?? "ARTAO";
  const twoWay = !!SLIP_BOOKS[BOOK].twoWay;
  function switchBook(b: SlipBookId) {
    if (b === BOOK) return;
    setData(null); setDay(""); setBookState(b);
    try { window.history.replaceState(null, "", b === "ARTAO" ? "/slips" : `/slips?book=${b}`); } catch { /* keep going */ }
  }
  const [data, setData] = useState<Data | null>(null);
  const [day, setDay] = useState("");            // "" = the open round
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [zoom, setZoom] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});   // amounts being typed
  const sheetRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  // each slip picture as its own data: URL for the round sheet (see SlipSheet)
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    (async () => {
      const need = (data?.items ?? []).filter((it) => counted(it) && !thumbs[it.img]);
      for (const it of need) {
        try {
          const r = await fetch(fileUrl(it.img), { cache: "force-cache" });
          if (!r.ok) continue;
          const b = await r.blob();
          const url = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(b); });
          if (!alive) return;
          setThumbs((t) => ({ ...t, [it.img]: url }));
        } catch { /* leave it to the plain URL */ }
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const load = useCallback(async (d: string) => {
    if (!bookState) return;
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/slips?book=${BOOK}${d ? `&day=${d}` : ""}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      if ((j as Data).book !== BOOK) return;   // a slow answer for the other book
      setData(j as Data);
      setDraft({});
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookState]);

  useEffect(() => { void load(day); }, [load, day]);
  useEffect(() => {
    const onShow = () => { if (document.visibilityState === "visible") void load(day); };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [load, day]);

  function flash(msg: string) { setStatus(msg); window.setTimeout(() => setStatus(""), 2500); }

  async function post(body: Record<string, unknown>, okMsg = "") {
    if (!data) return;
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/slips", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ book: BOOK, day: data.day, ...body }) });
      const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData((d) => (d ? { ...d, items: (j.items as SlipItem[] | undefined) ?? d.items, closed: (j.closed as Record<string, number> | undefined) ?? d.closed, round: (j.round as string | undefined) ?? d.round } : d));
      if (okMsg) flash(okMsg);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  }

  const items = useMemo(() => byArrival(data?.items ?? []), [data]);
  const line = formula(items);
  const closedAt = data ? data.closed[data.day] : undefined;
  const isRound = !!data && data.day === data.round;

  // one picture: every slip of the round + the table + the total
  async function exportSheet() {
    if (!data || !sheetRef.current) return;
    const missing = items.filter((it) => counted(it) && !thumbs[it.img]).length;
    if (missing) { setError(`รูปสลิปยังโหลดไม่ครบ (${missing} ใบ) รอสักครู่แล้วกดใหม่`); return; }
    setExporting(true); setError("");
    try {
      const blob = await captureNode(sheetRef.current, 2);
      if (blob) downloadBlob(blob, `slips_${data.day.replace(/-/g, "")}_${SLIP_BOOKS[BOOK].label}.png`);
      flash("ได้รูปสรุปรอบแล้ว");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    setExporting(false);
  }
  async function copyLine() {
    try { await navigator.clipboard.writeText(`เงินโอน\n${line}`); flash("คัดลอกแล้ว"); } catch { setError("คัดลอกไม่ได้ — กดค้างที่ข้อความเพื่อคัดลอกเอง"); }
  }
  function saveAmount(it: SlipItem) {
    const raw = draft[it.id];
    if (raw === undefined) return;
    const n = Number(raw.replace(/,/g, ""));
    if (!Number.isFinite(n) || n < 0) { setError("ยอดเงินไม่ถูกต้อง"); return; }
    if (n !== it.amount) void post({ action: "update", id: it.id, patch: { amount: n, isSlip: true } }, "แก้ยอดแล้ว");
  }
  function moveTo(it: SlipItem, to: string) {
    if (!to || !data || to === data.day) return;
    if (!window.confirm(`ย้ายสลิป ${money(it.amount)} บาท ไปรอบ ${dayTh(to)}?`)) return;
    void post({ action: "move", id: it.id, to }, `ย้ายไปรอบ ${dayTh(to)} แล้ว`);
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-3 pb-24 pt-4 sm:px-6">
      <div className="rounded-3xl bg-gradient-to-r from-teal-100 via-sky-100 to-violet-100 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-bold text-slate-800">🧾 สลิปโอน</h1>
          <div className="flex gap-1">
            {(Object.keys(SLIP_BOOKS) as SlipBookId[]).map((b) => (
              <button key={b} type="button" onClick={() => switchBook(b)} className={`rounded-full px-3 py-1 text-sm font-semibold ${b === BOOK ? "bg-pink-500 text-white" : "bg-white/80 text-slate-600"}`}>{SLIP_BOOKS[b].label}</button>
            ))}
          </div>
          <button type="button" disabled={busy} onClick={() => void load(day)} className="rounded-full bg-white/80 px-3 py-1 text-sm font-semibold text-teal-700 disabled:opacity-50">{busy ? "กำลังโหลด…" : "↻ รีเฟรช"}</button>
        </div>
        {data && (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <button type="button" disabled={busy} onClick={() => setDay(addDays(data.day, -1))} className="rounded-full bg-white/80 px-3 py-1 font-semibold text-slate-700 disabled:opacity-50">◀</button>
              <input type="date" value={data.day} onChange={(e) => { if (e.target.value) setDay(e.target.value); }} className="rounded-full border border-white bg-white/90 px-3 py-1 font-semibold text-slate-800" />
              <button type="button" disabled={busy} onClick={() => setDay(addDays(data.day, 1))} className="rounded-full bg-white/80 px-3 py-1 font-semibold text-slate-700 disabled:opacity-50">▶</button>
              {!isRound && <button type="button" disabled={busy} onClick={() => setDay("")} className="rounded-full bg-teal-500 px-3 py-1 font-semibold text-white disabled:opacity-50">ไปรอบที่เปิดอยู่ ({dayTh(data.round)})</button>}
              <span className={`rounded-full px-3 py-1 font-semibold ${closedAt ? "bg-slate-200 text-slate-600" : isRound ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                {closedAt ? `ตัดจบแล้ว ${bkkTime(closedAt)}` : isRound ? "รอบที่เปิดอยู่ — สลิปใหม่ลงรอบนี้" : "ยังไม่ได้ตัดจบ"}
              </span>
            </div>
            <div className="mt-3 rounded-2xl bg-white/85 p-3">
              <p className="text-xs font-semibold text-slate-500">เงินโอน รอบ {dayTh(data.day)} · {items.filter(counted).length} ใบ</p>
              {twoWay
                ? <p className="mt-1 text-lg font-bold text-slate-800"><span className="text-cyan-700">✈ สำรองจ่าย {money(totalOut(items))}</span> · <span className="text-emerald-700">💰 โอนเข้า {money(totalIn(items))}</span><span className="block text-xs font-normal text-slate-500">สลิปที่เราจ่าย = คิด{SLIP_BOOKS[BOOK].label}ในบัญชี · สลิปที่{SLIP_BOOKS[BOOK].label}โอน = เงินเข้า — กดปุ่มบนสลิปเพื่อสลับทาง</span></p>
                : <p className="mt-1 break-words text-lg font-bold text-slate-800">{line}</p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {!twoWay && <button type="button" onClick={() => void copyLine()} className="rounded-full bg-sky-400 px-3 py-1 text-sm font-semibold text-white">📋 คัดลอกบรรทัดนี้</button>}
                {!twoWay && <button type="button" disabled={exporting || !items.length} onClick={() => void exportSheet()} className="rounded-full bg-violet-500 px-3 py-1 text-sm font-semibold text-white disabled:opacity-50">{exporting ? "กำลังทำรูป…" : "🖼 รูปสรุปรอบ (ทุกสลิป+ตาราง)"}</button>}
                {closedAt
                  ? <button type="button" disabled={busy} onClick={() => void post({ action: "reopen" }, "เปิดรอบแล้ว")} className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-slate-600 ring-1 ring-slate-200 disabled:opacity-50">🔓 เปิดรอบอีกครั้ง</button>
                  : <button type="button" disabled={busy} onClick={() => { if (window.confirm(`ตัดจบรอบ ${dayTh(data.day)}? สลิปที่มาหลังจากนี้จะขึ้นเป็นรอบวันถัดไป`)) void post({ action: "close" }, "ตัดจบแล้ว"); }} className="rounded-full bg-pink-400 px-3 py-1 text-sm font-semibold text-white disabled:opacity-50">✅ ตัดจบรอบนี้</button>}
              </div>
            </div>
          </>
        )}
      </div>

      {error && <p className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">{error}</p>}
      {status && <p className="fixed bottom-20 left-1/2 z-40 sm:bottom-5 -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-sm text-white shadow-lg">{status}</p>}

      {data && !items.length && <p className="mt-6 text-center text-sm text-slate-500">ยังไม่มีสลิปในรอบนี้ — forward สลิปเข้ากลุ่ม LINE ห้องสลิปได้เลย</p>}

      <div className="mt-3 space-y-3">
        {items.map((it, k) => {
          const ok = counted(it);
          return (
            <div key={it.id} className={`flex gap-3 rounded-2xl border bg-white p-3 shadow-sm ${ok ? "border-teal-100" : "border-amber-200 bg-amber-50/40"}`}>
              <button type="button" onClick={() => setZoom(it.img)} className="h-24 w-16 shrink-0 overflow-hidden rounded-xl ring-1 ring-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={fileUrl(it.img)} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400">#{k + 1}</span>
                  <input
                    inputMode="decimal"
                    value={draft[it.id] ?? (it.amount ? money(it.amount) : "")}
                    onChange={(e) => setDraft((d) => ({ ...d, [it.id]: e.target.value }))}
                    onBlur={() => saveAmount(it)}
                    onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    placeholder="ยอดเงิน"
                    className="w-32 rounded-lg border border-slate-200 px-2 py-1 text-base font-bold text-slate-800"
                  />
                  <span className="text-slate-500">บาท</span>
                  {twoWay && it.isSlip && <button type="button" disabled={busy} onClick={() => void post({ action: "update", id: it.id, patch: { out: !it.out } }, it.out ? "เปลี่ยนเป็นโอนเข้าแล้ว" : "เปลี่ยนเป็นสำรองจ่ายแล้ว")} title="กดเพื่อสลับทาง" className={`rounded-full px-2.5 py-0.5 text-xs font-bold disabled:opacity-50 ${it.out ? "bg-cyan-100 text-cyan-800" : "bg-emerald-100 text-emerald-800"}`}>{it.out ? "✈ เราสำรองจ่าย" : "💰 โอนเข้า"} ⇄</button>}
                  {it.dupOf && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700">ซ้ำ ไม่นับ</span>}
                  {!it.isSlip && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">ไม่ใช่สลิป</span>}
                  {it.excluded && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">ตัดออก</span>}
                  {it.isSlip && !it.amount && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-600">ยังไม่มียอด</span>}
                </div>
                <p className="mt-1 text-slate-700">{[it.paidDate, it.paidTime].filter(Boolean).join(" ") || "ไม่ทราบเวลาโอน"}{it.sender ? ` · ${it.sender}` : ""}{it.bank ? ` (${it.bank})` : ""}</p>
                <p className="truncate text-xs text-slate-400">{it.ref ? `อ้างอิง ${it.ref} · ` : ""}ส่งเข้ากลุ่ม {bkkTime(it.ts)}{it.note ? ` · ${it.note}` : ""}</p>
                {twoWay && (
                  <input defaultValue={it.note ?? ""} placeholder="โน้ต เช่น ชื่อลูกค้า / ไฟลต์ (ขึ้นในใบแจ้งยอด)" onBlur={(e) => { const v = e.target.value.trim(); if (v !== (it.note ?? "")) void post({ action: "update", id: it.id, patch: { note: v } }, "บันทึกโน้ตแล้ว"); }}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-700" />
                )}
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <button type="button" disabled={busy} onClick={() => void post({ action: "update", id: it.id, patch: { excluded: !it.excluded } }, it.excluded ? "นับแล้ว" : "ตัดออกแล้ว")} className="rounded-full border border-slate-200 px-2.5 py-1 font-medium text-slate-600 disabled:opacity-50">{it.excluded ? "นับใบนี้" : "ไม่นับใบนี้"}</button>
                  {it.dupOf && <button type="button" disabled={busy} onClick={() => void post({ action: "update", id: it.id, patch: { dupOf: null } }, "นับใบนี้แล้ว")} className="rounded-full border border-amber-200 px-2.5 py-1 font-medium text-amber-700 disabled:opacity-50">ไม่ซ้ำ นับด้วย</button>}
                  <label className="flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-1 font-medium text-slate-600">
                    ย้ายรอบ
                    <input type="date" disabled={busy} value="" onChange={(e) => moveTo(it, e.target.value)} className="w-[7.5rem] bg-transparent text-xs" />
                  </label>
                  <button type="button" disabled={busy} onClick={() => { if (window.confirm("ลบสลิปนี้ออกจากบันทึก?")) void post({ action: "delete", id: it.id }, "ลบแล้ว"); }} className="rounded-full border border-rose-200 px-2.5 py-1 font-medium text-rose-600 disabled:opacity-50">ลบ</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {data && items.length > 0 && !twoWay && <p className="mt-4 text-right text-sm font-semibold text-slate-700">รวมที่นับ {money(total(items))} บาท</p>}

      {data && items.length > 0 && !twoWay && (
        <div className="mt-8">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">ตัวอย่างรูปสรุปรอบ</h2>
          <div className="overflow-auto rounded-2xl ring-1 ring-slate-200">
            <SlipSheet ref={sheetRef} book={SLIP_BOOKS[BOOK].label} day={data.day} items={items} closedAt={closedAt} srcOf={(it) => thumbs[it.img] ?? fileUrl(it.img)} />
          </div>
        </div>
      )}

      {zoom && (
        <button type="button" onClick={() => setZoom("")} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={fileUrl(zoom)} alt="" className="max-h-full max-w-full rounded-2xl" />
        </button>
      )}
    </main>
  );
}
