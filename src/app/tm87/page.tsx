"use client";

// =============================================================
// /tm87 — fill the TM.87 (Application for visa) one person at a time
// =============================================================
// Scan the passport / entry stamp / TM30 receipt with the same AI scanners as
// the single TM.7 form, add the reason and the 4×6 photo, download the PDF.

import { useState } from "react";
import AiPassportScanner, { type AiScanResult } from "@/components/AiPassportScanner";
import AiStampScanner, { type StampScanResult } from "@/components/AiStampScanner";
import AiTm30Scanner, { type AiTm30ScanResult } from "@/components/AiTm30Scanner";
import { ddmmyyyyToIso } from "@/lib/today/types";
import type { Tm87Data } from "@/lib/tm87/generator";

type Form = {
  office: string; date: string; title: Tm87Data["title"];
  lastName: string; firstName: string; middleName: string; dateOfBirth: string; placeOfBirth: string; nationality: string;
  passportNo: string; passportIssueDate: string; passportIssuedAt: string; passportExpiryDate: string;
  visaKind: string; arrivedBy: string; fromCountry: string; portOfArrival: string; arrivalDate: string; tm6No: string;
  reason: string; addressInThailand: string; writer: string;
  houseNo: string; road: string; subDistrict: string; district: string; province: string;
};
const todayIso = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const isoToDdmmyyyy = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);
const EMPTY: Form = {
  office: "BANGKOK", date: todayIso(), title: "MR.",
  lastName: "", firstName: "", middleName: "", dateOfBirth: "", placeOfBirth: "", nationality: "",
  passportNo: "", passportIssueDate: "", passportIssuedAt: "", passportExpiryDate: "",
  visaKind: "", arrivedBy: "", fromCountry: "", portOfArrival: "", arrivalDate: "", tm6No: "",
  reason: "", addressInThailand: "", writer: "",
  houseNo: "", road: "", subDistrict: "", district: "", province: "",
};
const inp = "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm";
// defined at module level so React keeps the same input mounted while typing
function TextField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  return <label className="block text-xs text-slate-600">{label}<input className={inp} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></label>;
}
const REASONS = [
  "TO APPLY FOR NON-IMMIGRANT B VISA (EMPLOYMENT)",
  "TO APPLY FOR NON-IMMIGRANT O VISA (THAI SPOUSE / FAMILY)",
  "TO APPLY FOR NON-IMMIGRANT O VISA (RETIREMENT)",
  "TO APPLY FOR NON-IMMIGRANT ED VISA (STUDY)",
  "TO APPLY FOR NON-IMMIGRANT O VISA (GUARDIAN OF THAI CHILD)",
];

export default function Tm87Page() {
  const [f, setF] = useState<Form>(EMPTY);
  const [photo, setPhoto] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const up = (s: string) => s.toUpperCase();

  function onPassport(d: AiScanResult) {
    setF((p) => ({
      ...p,
      title: (d.title as Form["title"]) || p.title, firstName: d.firstName || p.firstName, lastName: d.lastName || p.lastName,
      nationality: d.nationality || p.nationality, dateOfBirth: d.dateOfBirth || p.dateOfBirth, placeOfBirth: d.placeOfBirth || p.placeOfBirth,
      passportNo: d.passportNo || p.passportNo, passportIssueDate: d.passportIssueDate || p.passportIssueDate,
      passportExpiryDate: d.passportExpiryDate || p.passportExpiryDate, passportIssuedAt: d.passportIssuedAt || p.passportIssuedAt,
    }));
    setMsg("อ่านพาสปอร์ตแล้ว ตรวจชื่อ/เลข/วันที่อีกครั้ง"); setError("");
  }
  function onStamp(d: StampScanResult) {
    setF((p) => ({ ...p, arrivalDate: d.arrivalDate || p.arrivalDate, portOfArrival: d.portOfArrival || p.portOfArrival, arrivedBy: d.arrivedBy || p.arrivedBy, visaKind: d.visaType || p.visaKind }));
    setMsg("อ่านตราเข้าแล้ว"); setError("");
  }
  function onTm30(d: AiTm30ScanResult) {
    setF((p) => ({ ...p, houseNo: d.houseNo || p.houseNo, road: d.road || p.road, subDistrict: d.subDistrict || p.subDistrict, district: d.district || p.district, province: d.province || p.province }));
    setMsg("อ่านที่อยู่จาก TM30 แล้ว"); setError("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setMsg("");
    try {
      for (const [k, v] of [["วันเกิด", f.dateOfBirth], ["วันออกพาส", f.passportIssueDate], ["พาสหมดอายุ", f.passportExpiryDate], ["วันเข้า", f.arrivalDate]] as const) {
        if (v && !ddmmyyyyToIso(v)) throw new Error(`${k}: ใช้รูปแบบ DD/MM/YYYY`);
      }
      const payload: Tm87Data = {
        office: f.office, date: f.date, title: f.title, lastName: f.lastName, firstName: f.firstName, middleName: f.middleName,
        dateOfBirth: ddmmyyyyToIso(f.dateOfBirth), placeOfBirth: f.placeOfBirth, nationality: f.nationality,
        passportNo: f.passportNo, passportIssueDate: ddmmyyyyToIso(f.passportIssueDate), passportIssuedAt: f.passportIssuedAt, passportExpiryDate: ddmmyyyyToIso(f.passportExpiryDate),
        visaKind: f.visaKind, arrivedBy: f.arrivedBy, fromCountry: f.fromCountry, portOfArrival: f.portOfArrival, arrivalDate: ddmmyyyyToIso(f.arrivalDate), tm6No: f.tm6No,
        reason: f.reason, addressInThailand: f.addressInThailand, writer: f.writer,
        houseNo: f.houseNo, road: f.road, subDistrict: f.subDistrict, district: f.district, province: f.province,
      };
      const fd = new FormData();
      fd.set("payload", JSON.stringify(payload));
      if (photo) fd.set("photo", photo);
      const r = await fetch("/api/tm87", { method: "POST", body: fd });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j as { error?: string }).error || `HTTP ${r.status}`); }
      const blob = await r.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = `TM87_${f.lastName}_${f.firstName}.pdf`.replace(/\s+/g, "_"); a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setMsg("ดาวน์โหลด TM.87 แล้ว");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  // plain function (not a component) so inputs keep focus while typing
  const field = (label: string, k: keyof Form, placeholder?: string) => (
    <TextField key={k} label={label} value={f[k] as string} placeholder={placeholder} onChange={(v) => set(k, up(v) as Form[typeof k])} />
  );

  return (
    <main className="mx-auto max-w-3xl p-3 sm:p-5">
      <h1 className="mb-1 text-xl font-bold text-violet-700">📄 TM.87 — คำขอรับการตรวจลงตรา</h1>
      <p className="mb-3 text-xs text-slate-500">สแกนพาสปอร์ต / ตราเข้า / ใบ TM30 ให้กรอกเอง แล้วเติมเหตุผลกับรูป 4×6 · ค่าธรรมเนียม 2,000 บาท ยื่นด้วยตนเอง</p>
      <div className="mb-3 flex flex-wrap gap-2">
        <AiPassportScanner onScan={onPassport} onError={setError} />
        <AiStampScanner onScan={onStamp} onError={setError} />
        <AiTm30Scanner onScan={(d) => onTm30(d)} onError={setError} />
      </div>
      {msg && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</div>}
      {error && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      <form onSubmit={submit} className="space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">หัวฟอร์ม</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {field("สำนักงาน ตม.", "office", "BANGKOK")}
            <label className="block text-xs text-slate-600">วันที่ยื่น<input type="date" className={inp} value={f.date} onChange={(e) => set("date", e.target.value)} /></label>
            <label className="block text-xs text-slate-600">คำนำหน้า<select className={inp} value={f.title} onChange={(e) => set("title", e.target.value as Form["title"])}><option>MR.</option><option>MRS.</option><option>MISS</option></select></label>
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">ผู้ยื่น</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {field("นามสกุล (family name)", "lastName")}
            {field("ชื่อ (first name)", "firstName")}
            {field("ชื่อรอง (middle)", "middleName")}
            {field("วันเกิด DD/MM/YYYY", "dateOfBirth", "05/03/1992")}
            {field("สถานที่เกิด", "placeOfBirth")}
            {field("สัญชาติ", "nationality", "CHINESE")}
            {field("เลขพาสปอร์ต", "passportNo")}
            {field("วันออกพาส DD/MM/YYYY", "passportIssueDate")}
            {field("ออกให้ที่", "passportIssuedAt")}
            {field("พาสหมดอายุ DD/MM/YYYY", "passportExpiryDate")}
            {field("ประเภทวีซ่าที่ถืออยู่", "visaKind", "TOURIST / EXEMPTION")}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">การเดินทางเข้า</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {field("โดยสารพาหนะ", "arrivedBy", "AIRPLANE")}
            {field("จาก", "fromCountry", "CHINA")}
            {field("เข้ามาทางด่าน", "portOfArrival", "SUVARNABHUMI AIRPORT")}
            {field("วันเข้า DD/MM/YYYY", "arrivalDate")}
            {field("บัตร ตม.6 ลำดับที่", "tm6No", "-")}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">เหตุผลที่ขอรับการตรวจลงตรา</h2>
          <select className={`${inp} mb-2`} value="" onChange={(e) => e.target.value && set("reason", e.target.value)}>
            <option value="">— เลือกเหตุผลสำเร็จรูป —</option>
            {REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
          <textarea className={`${inp} h-16`} value={f.reason} onChange={(e) => set("reason", up(e.target.value))} placeholder="TO APPLY FOR NON-IMMIGRANT B VISA FOR EMPLOYMENT WITH … CO., LTD." />
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-3">
          <h2 className="mb-2 text-sm font-semibold text-slate-700">ที่พักในประเทศไทย (หน้า 2)</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {field("บ้านเลขที่", "houseNo")}
            {field("ถนน", "road")}
            {field("ตำบล/แขวง", "subDistrict")}
            {field("อำเภอ/เขต", "district")}
            {field("จังหวัด", "province")}
            {field("ผู้เขียนคำขอ (ว่าง = ผู้ยื่น)", "writer")}
          </div>
          <label className="mt-2 block text-xs text-slate-600">ที่พักบรรทัดเดียว (ว่าง = รวมจากช่องด้านบน)<input className={inp} value={f.addressInThailand} onChange={(e) => set("addressInThailand", up(e.target.value))} /></label>
          <label className="mt-2 block text-xs text-slate-600">รูปถ่าย 4×6 ซม. (jpg/png)<input type="file" accept="image/jpeg,image/png" className="block text-sm" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} /></label>
        </section>

        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{busy ? "กำลังสร้าง…" : "⬇️ ดาวน์โหลด TM.87 (PDF)"}</button>
          <button type="button" onClick={() => { setF({ ...EMPTY, date: todayIso() }); setPhoto(null); setMsg(""); setError(""); }} className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm">ล้างฟอร์ม</button>
        </div>
      </form>
      <p className="mt-3 text-[11px] text-slate-400">วันที่บนฟอร์มพิมพ์เป็น วัน / ชื่อเดือนอังกฤษ / ค.ศ. เหมือน TM.7 · วันเกิดที่กรอก {f.dateOfBirth ? `→ อายุคำนวณอัตโนมัติ (${isoToDdmmyyyy(f.date)})` : ""}</p>
    </main>
  );
}
