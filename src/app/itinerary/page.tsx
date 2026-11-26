"use client";

// =============================================================
// /itinerary — ✈️ ตั๋ว → รูป itinerary ให้ลูกค้า visa run
// =============================================================
// After booking a customer's flights: drop the tickets here (Trip.com
// itinerary PDFs, boarding passes, as PDF or photo) plus passport pages for
// the Chinese names. Each file is read by Gemini (scanTicket), folded into
// one trip, shown for a re-check, and exported as a picture in 中文 / ไทย /
// English. Nothing is stored on the server; the draft lives in this browser
// (localStorage) until "ล้างทั้งหมด".

import { useEffect, useRef, useState } from "react";
import ItinerarySheet, { type ItineraryLang } from "@/components/ItinerarySheet";
import { scanTicket } from "@/app/actions/scanTicket";
import { captureNode, downloadBlob, downscaleImage } from "@/lib/today/clientTools";
import { emptyTrip, mergeDoc, sortedFlights, tripDateKey, tripWarnings, type Flight, type PersonName, type Rider, type Trip } from "@/lib/itinerary/types";

const DRAFT_KEY = "itinerary-draft-v1";
const MAX_UPLOAD = 4 * 1024 * 1024;
const LANGS: { id: ItineraryLang; label: string; file: string }[] = [
  { id: "zh", label: "中文", file: "CN" },
  { id: "th", label: "ไทย", file: "TH" },
  { id: "en", label: "English", file: "EN" },
];

type FileLog = { name: string; state: "reading" | "ok" | "error"; note: string };

const input = "w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm";
const label = "block text-[11px] font-medium text-slate-500";

export default function ItineraryPage() {
  const [trip, setTrip] = useState<Trip>(emptyTrip);
  const [logs, setLogs] = useState<FileLog[]>([]);
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<ItineraryLang>("zh");
  const [status, setStatus] = useState("");
  const [loaded, setLoaded] = useState(false);
  const refs = { zh: useRef<HTMLDivElement>(null), th: useRef<HTMLDivElement>(null), en: useRef<HTMLDivElement>(null) };

  // draft: restore once, then save on every change
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const t = JSON.parse(raw) as Trip;
        if (t && Array.isArray(t.people) && Array.isArray(t.flights)) setTrip({ ...emptyTrip(), ...t });
      }
    } catch { /* no draft */ }
    setLoaded(true);
  }, []);
  useEffect(() => {
    if (!loaded) return;
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(trip)); } catch { /* storage full or blocked */ }
  }, [trip, loaded]);

  async function addFiles(list: FileList | null) {
    if (!list || !list.length) return;
    setBusy(true);
    setStatus("");
    for (const file of Array.from(list)) {
      const setLog = (state: FileLog["state"], note: string) =>
        setLogs((prev) => [...prev.filter((l) => l.name !== file.name), { name: file.name, state, note }]);
      setLog("reading", "กำลังอ่าน…");
      try {
        const blob = await downscaleImage(file, 2000, 0.9);
        if (blob.size > MAX_UPLOAD) { setLog("error", `ไฟล์ ${(blob.size / 1024 / 1024).toFixed(1)} MB ใหญ่เกิน 4 MB`); continue; }
        const fd = new FormData();
        fd.append("file", new File([blob], file.name, { type: blob.type || file.type }));
        const res = await scanTicket(fd);
        if (!res.ok) { setLog("error", res.error); continue; }
        const doc = res.data;
        if (doc.kind === "other" || (doc.kind === "ticket" && doc.legs.length === 0)) { setLog("error", "อ่านไม่ออกว่าเป็นตั๋วหรือพาสปอร์ต"); continue; }
        setTrip((prev) => mergeDoc(prev, doc));
        setLog("ok", doc.kind === "passport"
          ? `พาสปอร์ต: ${doc.passport.surname} ${doc.passport.given} ${doc.passport.cnName}`
          : `ตั๋ว: ${doc.legs.map((l) => `${l.flightNo} (${l.passengers.length} คน)`).join(", ")}`);
      } catch (e) {
        setLog("error", e instanceof Error ? e.message : String(e));
      }
    }
    setBusy(false);
  }

  // ---------- edits ----------
  const patchFlight = (id: string, patch: Partial<Flight>) =>
    setTrip((t) => ({ ...t, flights: t.flights.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  const patchRider = (fid: string, rid: string, patch: Partial<Rider>) =>
    setTrip((t) => ({ ...t, flights: t.flights.map((f) => (f.id === fid ? { ...f, riders: f.riders.map((r) => (r.id === rid ? { ...r, ...patch } : r)) } : f)) }));
  const removeRider = (fid: string, rid: string) =>
    setTrip((t) => ({ ...t, flights: t.flights.map((f) => (f.id === fid ? { ...f, riders: f.riders.filter((r) => r.id !== rid) } : f)) }));
  const addRider = (fid: string, pid: string) =>
    setTrip((t) => ({ ...t, flights: t.flights.map((f) => (f.id === fid && !f.riders.some((r) => r.id === pid) ? { ...f, riders: [...f.riders, { id: pid, pnr: f.riders[0]?.pnr ?? "", seat: "", hasBoardingPass: false }] } : f)) }));
  const removeFlight = (id: string) => setTrip((t) => ({ ...t, flights: t.flights.filter((f) => f.id !== id) }));
  const addFlight = () =>
    setTrip((t) => ({ ...t, flights: [...t.flights, { id: `manual-${Date.now()}`, airline: "", flightNo: "", date: t.flights[0]?.date ?? "", from: "", to: "", fromTerminal: "", toTerminal: "", depTime: "", arrTime: "", boardTime: "", gate: "", riders: [] }] }));
  const patchPerson = (id: string, patch: Partial<PersonName>) =>
    setTrip((t) => ({ ...t, people: t.people.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
  const addPerson = () =>
    setTrip((t) => ({ ...t, people: [...t.people, { id: `manual-${Date.now()}`, surname: "", given: "", cn: "" }] }));
  const removePerson = (id: string) =>
    setTrip((t) => ({ ...t, people: t.people.filter((p) => p.id !== id), flights: t.flights.map((f) => ({ ...f, riders: f.riders.filter((r) => r.id !== id) })) }));
  function clearAll() {
    setTrip(emptyTrip());
    setLogs([]);
    setStatus("");
  }

  // ---------- export ----------
  async function exportLangs(ids: ItineraryLang[]) {
    setStatus("กำลังสร้างรูป…");
    try {
      const day = tripDateKey(trip) || "trip";
      for (const id of ids) {
        const el = refs[id].current;
        if (!el) continue;
        const blob = await captureNode(el, 2);
        if (!blob) throw new Error("สร้างรูปไม่สำเร็จ");
        downloadBlob(blob, `VisaRun_${day}_Itinerary_${LANGS.find((l) => l.id === id)!.file}.png`);
        await new Promise((r) => setTimeout(r, 400)); // iOS drops back-to-back downloads
      }
      setStatus("ดาวน์โหลดรูปแล้ว");
    } catch (e) {
      setStatus(`สร้างรูปไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const flights = sortedFlights(trip);
  const warn = tripWarnings(trip);
  const nameOf = (id: string) => { const p = trip.people.find((x) => x.id === id); return p ? `${p.surname} ${p.given}${p.cn ? ` ${p.cn}` : ""}`.trim() : id; };
  const missingCn = trip.people.filter((p) => !p.cn && flights.some((f) => f.riders.some((r) => r.id === p.id)));
  const hasTrip = flights.some((f) => f.riders.length > 0);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">✈️ Itinerary ลูกค้า Visa Run</h1>
          <p className="text-sm text-slate-500">อัปโหลดตั๋ว (และพาสปอร์ต) → ตรวจ → ดาวน์โหลดรูป 中文 / ไทย / English</p>
        </div>
        <button type="button" onClick={clearAll} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">ล้างทั้งหมด</button>
      </div>

      {/* 1 · upload */}
      <section className="rounded-2xl border-2 border-dashed border-sky-300 bg-sky-50 p-4">
        <label htmlFor="itinerary-files" className="block cursor-pointer text-center">
          <span className="block text-sm font-semibold text-sky-800">{busy ? "กำลังอ่านไฟล์…" : "แตะเพื่อเลือกไฟล์ตั๋ว / boarding pass / พาสปอร์ต"}</span>
          <span className="block text-xs text-sky-700">PDF หรือรูป เลือกได้หลายไฟล์ · ไฟล์ละไม่เกิน 4 MB · เพิ่มทีหลังได้เรื่อย ๆ</span>
        </label>
        <input id="itinerary-files" type="file" multiple accept="application/pdf,image/*" disabled={busy} className="sr-only"
          onChange={(e) => { const l = e.target.files; void addFiles(l).then(() => { e.target.value = ""; }); }} />
        {logs.length > 0 && (
          <ul className="mt-3 space-y-1 text-xs">
            {logs.map((l) => (
              <li key={l.name} className={l.state === "error" ? "text-rose-700" : l.state === "ok" ? "text-emerald-700" : "text-slate-600"}>
                {l.state === "error" ? "✗" : l.state === "ok" ? "✓" : "…"} <span className="font-medium">{l.name}</span> — {l.note}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* warnings for us (Thai) */}
      {hasTrip && (warn.timeConflict.size > 0 || warn.airportSwap.length > 0 || missingCn.length > 0) && (
        <section className="mt-4 space-y-1 rounded-2xl bg-rose-50 p-3 text-sm text-rose-800">
          {warn.timeConflict.size > 0 && <p>⚠️ ไฟล์ทเดียวกันมีเวลาออกไม่ตรงกัน (ตั๋วคนละใบพิมพ์เวลาคนละเวลา) ตรวจกับสายการบินแล้วแก้เวลาด้านล่างให้ตรงกัน การ์ดจะรวมเป็นใบเดียวเองไม่ได้ ต้องลบใบที่ผิดแล้วย้ายคนมา</p>}
          {warn.airportSwap.length > 0 && <p>⚠️ มีคนที่ขาไปกับขากลับคนละสนามบินในกรุงเทพฯ: {warn.airportSwap.map(nameOf).join(", ")}</p>}
          {missingCn.length > 0 && <p>ยังไม่มีชื่อจีน: {missingCn.map((p) => `${p.surname} ${p.given}`).join(", ")} — อัปโหลดหน้าพาสปอร์ต หรือพิมพ์เองในหัวข้อผู้โดยสาร</p>}
        </section>
      )}

      {/* 2 · check + edit */}
      {trip.people.length > 0 && (
        <section className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">ผู้โดยสาร ({trip.people.length})</h2>
          <div className="space-y-2">
            {trip.people.map((p) => (
              <div key={p.id} className="grid grid-cols-[1fr_1.4fr_1fr_auto] items-end gap-2">
                <div><label className={label} htmlFor={`sn-${p.id}`}>นามสกุล</label><input id={`sn-${p.id}`} className={input} value={p.surname} onChange={(e) => patchPerson(p.id, { surname: e.target.value.toUpperCase() })} /></div>
                <div><label className={label} htmlFor={`gn-${p.id}`}>ชื่อ</label><input id={`gn-${p.id}`} className={input} value={p.given} onChange={(e) => patchPerson(p.id, { given: e.target.value.toUpperCase() })} /></div>
                <div><label className={label} htmlFor={`cn-${p.id}`}>ชื่อจีน</label><input id={`cn-${p.id}`} className={input} value={p.cn} onChange={(e) => patchPerson(p.id, { cn: e.target.value })} /></div>
                <button type="button" onClick={() => removePerson(p.id)} className="rounded-lg px-2 py-1 text-xs text-rose-600 hover:bg-rose-50" aria-label={`ลบ ${p.surname} ${p.given}`}>ลบ</button>
              </div>
            ))}
          </div>
          <button type="button" onClick={addPerson} className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">+ เพิ่มผู้โดยสารเอง</button>
        </section>
      )}

      {flights.map((f) => (
        <section key={f.id} className="mt-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">{f.flightNo || "ไฟลท์ใหม่"} · {f.from || "?"} → {f.to || "?"} · {f.date}</h2>
            <button type="button" onClick={() => removeFlight(f.id)} className="rounded-lg px-2 py-1 text-xs text-rose-600 hover:bg-rose-50">ลบไฟลท์นี้</button>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div><label className={label} htmlFor={`fn-${f.id}`}>เลขไฟลท์</label><input id={`fn-${f.id}`} className={input} value={f.flightNo} onChange={(e) => patchFlight(f.id, { flightNo: e.target.value.toUpperCase() })} /></div>
            <div><label className={label} htmlFor={`al-${f.id}`}>สายการบิน</label><input id={`al-${f.id}`} className={input} value={f.airline} onChange={(e) => patchFlight(f.id, { airline: e.target.value })} /></div>
            <div><label className={label} htmlFor={`dt-${f.id}`}>วันที่ (วว/ดด/ปปปป)</label><input id={`dt-${f.id}`} className={input} value={f.date} placeholder="01/12/2026" onChange={(e) => patchFlight(f.id, { date: e.target.value })} /></div>
            <div><label className={label} htmlFor={`gt-${f.id}`}>ประตู</label><input id={`gt-${f.id}`} className={input} value={f.gate} onChange={(e) => patchFlight(f.id, { gate: e.target.value.toUpperCase() })} /></div>
            <div><label className={label} htmlFor={`fr-${f.id}`}>จาก (DMK/BKK/CEI)</label><input id={`fr-${f.id}`} className={input} value={f.from} onChange={(e) => patchFlight(f.id, { from: e.target.value.toUpperCase() })} /></div>
            <div><label className={label} htmlFor={`ft-${f.id}`}>อาคารต้นทาง</label><input id={`ft-${f.id}`} className={input} value={f.fromTerminal} placeholder="T2" onChange={(e) => patchFlight(f.id, { fromTerminal: e.target.value.toUpperCase() })} /></div>
            <div><label className={label} htmlFor={`to-${f.id}`}>ถึง</label><input id={`to-${f.id}`} className={input} value={f.to} onChange={(e) => patchFlight(f.id, { to: e.target.value.toUpperCase() })} /></div>
            <div><label className={label} htmlFor={`tt-${f.id}`}>อาคารปลายทาง</label><input id={`tt-${f.id}`} className={input} value={f.toTerminal} onChange={(e) => patchFlight(f.id, { toTerminal: e.target.value.toUpperCase() })} /></div>
            <div><label className={label} htmlFor={`bd-${f.id}`}>ขึ้นเครื่อง</label><input id={`bd-${f.id}`} className={input} value={f.boardTime} placeholder="19:00" onChange={(e) => patchFlight(f.id, { boardTime: e.target.value })} /></div>
            <div><label className={label} htmlFor={`dp-${f.id}`}>ออก</label><input id={`dp-${f.id}`} className={input} value={f.depTime} placeholder="08:35" onChange={(e) => patchFlight(f.id, { depTime: e.target.value })} /></div>
            <div><label className={label} htmlFor={`ar-${f.id}`}>ถึง (เวลา)</label><input id={`ar-${f.id}`} className={input} value={f.arrTime} placeholder="10:00" onChange={(e) => patchFlight(f.id, { arrTime: e.target.value })} /></div>
          </div>

          <div className="mt-3 space-y-2">
            {f.riders.map((r) => (
              <div key={r.id} className="grid grid-cols-[1.6fr_1fr_0.7fr_auto_auto] items-end gap-2">
                <div className="truncate pb-1 text-sm font-medium text-slate-800">{nameOf(r.id)}</div>
                <div><label className={label} htmlFor={`pnr-${f.id}-${r.id}`}>รหัสจอง</label><input id={`pnr-${f.id}-${r.id}`} className={`${input} font-mono`} value={r.pnr} onChange={(e) => patchRider(f.id, r.id, { pnr: e.target.value.toUpperCase() })} /></div>
                <div><label className={label} htmlFor={`seat-${f.id}-${r.id}`}>ที่นั่ง</label><input id={`seat-${f.id}-${r.id}`} className={input} value={r.seat} onChange={(e) => patchRider(f.id, r.id, { seat: e.target.value.toUpperCase() })} /></div>
                <label className="flex items-center gap-1 pb-1 text-xs text-slate-700"><input id={`bp-${f.id}-${r.id}`} type="checkbox" checked={r.hasBoardingPass} onChange={(e) => patchRider(f.id, r.id, { hasBoardingPass: e.target.checked })} /> มี boarding pass</label>
                <button type="button" onClick={() => removeRider(f.id, r.id)} className="rounded-lg px-2 py-1 text-xs text-rose-600 hover:bg-rose-50" aria-label={`เอา ${nameOf(r.id)} ออกจากไฟลท์นี้`}>เอาออก</button>
              </div>
            ))}
          </div>
          {trip.people.some((p) => !f.riders.some((r) => r.id === p.id)) && (
            <select id={`add-${f.id}`} aria-label="เพิ่มผู้โดยสารเข้าไฟลท์นี้" className="mt-2 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs" value="" onChange={(e) => { if (e.target.value) addRider(f.id, e.target.value); }}>
              <option value="">+ เพิ่มผู้โดยสารเข้าไฟลท์นี้</option>
              {trip.people.filter((p) => !f.riders.some((r) => r.id === p.id)).map((p) => <option key={p.id} value={p.id}>{nameOf(p.id)}</option>)}
            </select>
          )}
        </section>
      ))}

      {(trip.people.length > 0 || flights.length > 0) && (
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-700">
          <button type="button" onClick={addFlight} className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">+ เพิ่มไฟลท์เอง</button>
          <label className="flex items-center gap-1"><input id="opt-meet" type="checkbox" checked={trip.showMeetingPoint} onChange={(e) => setTrip((t) => ({ ...t, showMeetingPoint: e.target.checked }))} /> ใส่จุดนัดพบประตู 2 เชียงราย</label>
          <label className="flex items-center gap-1"><input id="opt-bag" type="checkbox" checked={trip.showBaggage} onChange={(e) => setTrip((t) => ({ ...t, showBaggage: e.target.checked }))} /> ใส่ข้อความกระเป๋า 7 กก. ไม่มีโหลด</label>
        </div>
      )}

      {/* 3 · preview + export */}
      {hasTrip && (
        <section className="mt-6">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-700">ตัวอย่างรูป</h2>
            {LANGS.map((l) => (
              <button key={l.id} type="button" onClick={() => setLang(l.id)} aria-pressed={lang === l.id}
                className={`rounded-full px-3 py-0.5 text-xs ${lang === l.id ? "bg-pink-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>{l.label}</button>
            ))}
            <span className="grow" />
            <button type="button" onClick={() => void exportLangs([lang])} className="rounded-lg bg-pink-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-pink-700">⬇️ รูป {LANGS.find((l) => l.id === lang)!.label}</button>
            <button type="button" onClick={() => void exportLangs(["zh", "th", "en"])} className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700">⬇️ ทั้ง 3 ภาษา</button>
          </div>
          {status && <p className="mb-2 text-xs text-slate-600" role="status">{status}</p>}
          <div className="overflow-auto rounded-2xl ring-1 ring-slate-200">
            <ItinerarySheet ref={refs[lang]} trip={trip} lang={lang} />
          </div>
          {/* the other two languages, off-screen, so "ทั้ง 3 ภาษา" can capture them */}
          <div aria-hidden="true" style={{ position: "fixed", left: -10000, top: 0 }}>
            {LANGS.filter((l) => l.id !== lang).map((l) => <ItinerarySheet key={l.id} ref={refs[l.id]} trip={trip} lang={l.id} />)}
          </div>
        </section>
      )}
    </main>
  );
}
