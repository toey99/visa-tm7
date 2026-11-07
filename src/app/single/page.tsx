"use client";

import { useState, useRef, useEffect } from "react";
import type { Tm7FormData, Title } from "@/lib/tm7-generator";
import { buildTm7Filename } from "@/lib/tm7-filename";
import AiPassportScanner, { type AiScanResult } from "@/components/AiPassportScanner";
import AiTm30Scanner, { type AiTm30ScanResult } from "@/components/AiTm30Scanner";

type FormState = {
  title: Title;
  firstName: string;
  lastName: string;
  nationality: string;
  dateOfBirth: string;
  placeOfBirth: string;
  passportNo: string;
  passportIssueDate: string;
  passportExpiryDate: string;
  passportIssuedAt: string;
  arrivalDate: string;
  fromCountry: string;
  portOfArrival: string;
  arrivedBy: string;
  visaType: string;
  houseNo: string;
  road: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
  phone: string;
  appointmentDate: string;
  formLocation: string;
  extensionDays: string;
  extensionReason: string;
};

const INITIAL: FormState = {
  title: "MR.",
  firstName: "",
  lastName: "",
  nationality: "CHINESE",
  dateOfBirth: "",
  placeOfBirth: "",
  passportNo: "",
  passportIssueDate: "",
  passportExpiryDate: "",
  passportIssuedAt: "",
  arrivalDate: "",
  fromCountry: "CHINA",
  portOfArrival: "SUVARNABHUMI AIRPORT",
  arrivedBy: "AIRPLANE",
  visaType: "EXEMPTION (PORPOR 60)",
  houseNo: "",
  road: "",
  subDistrict: "",
  district: "",
  province: "",
  postalCode: "",
  phone: "",
  appointmentDate: "",
  formLocation: "BANGKOK",
  extensionDays: "30",
  extensionReason: "TOURISM",
};

export default function Page() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>("");
  const [pdfUrl, setPdfUrl] = useState<string>("");
  const [scanWarning, setScanWarning] = useState<string>("");
  const [tm30Message, setTm30Message] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [tm30File, setTm30File] = useState<File | null>(null);
  // Android Chrome has no built-in inline PDF viewer, so a blob PDF inside an
  // <iframe> renders blank. Detect it and show a download/open card instead.
  // (Desktop + iOS Safari render inline PDFs fine, so they keep the iframe.)
  const [isAndroid, setIsAndroid] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIsAndroid(/Android/i.test(navigator.userAgent));
  }, []);

  // Default the appointment date to the user's local "today". Done in an effect
  // (client-only) rather than in initial state so the server's UTC clock can't
  // disagree with the browser's local date and cause a hydration mismatch near
  // midnight. The field stays a normal editable input, so users can change it.
  useEffect(() => {
    setForm((prev) => (prev.appointmentDate ? prev : { ...prev, appointmentDate: todayDdmmyyyy() }));
  }, []);

  function handleAiScan(data: AiScanResult) {
    const missing: string[] = [];
    if (!data.firstName) missing.push("first name");
    if (!data.lastName) missing.push("last name");
    if (!data.passportNo) missing.push("passport number");
    if (!data.nationality) missing.push("nationality");
    if (!data.dateOfBirth) missing.push("date of birth");
    if (!data.passportExpiryDate) missing.push("passport expiry");

    setForm((prev) => ({
      ...prev,
      title: data.title || prev.title,
      firstName: data.firstName || prev.firstName,
      lastName: data.lastName || prev.lastName,
      nationality: data.nationality || prev.nationality,
      passportNo: data.passportNo || prev.passportNo,
      dateOfBirth: data.dateOfBirth || prev.dateOfBirth,
      placeOfBirth: data.placeOfBirth || prev.placeOfBirth,
      passportIssueDate: data.passportIssueDate || prev.passportIssueDate,
      passportExpiryDate: data.passportExpiryDate || prev.passportExpiryDate,
      passportIssuedAt: data.passportIssuedAt || prev.passportIssuedAt,
    }));

    setError("");
    setScanWarning(
      missing.length > 0
        ? `Scanned, but the following fields could not be read and need manual entry: ${missing.join(", ")}.`
        : ""
    );
  }

  function handleScanError(msg: string) {
    setScanWarning(msg);
  }

  function handleTm30Scan(data: AiTm30ScanResult, file: File) {
    setTm30File(file);
    const missing: string[] = [];
    if (!data.houseNo) missing.push("house no.");
    if (!data.road) missing.push("road / street");
    if (!data.subDistrict) missing.push("sub-district");
    if (!data.district) missing.push("district");
    if (!data.province) missing.push("province");
    if (!data.postalCode) missing.push("postal code");

    setForm((prev) => ({
      ...prev,
      houseNo: data.houseNo || prev.houseNo,
      road: data.road || prev.road,
      subDistrict: data.subDistrict || prev.subDistrict,
      district: data.district || prev.district,
      province: data.province || prev.province,
      postalCode: data.postalCode || prev.postalCode,
    }));

    setTm30Message({
      type: missing.length > 0 ? "error" : "success",
      text:
        missing.length > 0
          ? `Address partially filled from TM.30. Please enter manually: ${missing.join(", ")}.`
          : "Address fields filled from TM.30. It will be attached as the final page of your packet.",
    });
  }

  function handleTm30Error(msg: string) {
    setTm30Message({ type: "error", text: msg });
  }

  useEffect(() => {
    return () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    };
  }, [pdfUrl]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const dateFields: Array<keyof FormState> = [
      "dateOfBirth",
      "passportIssueDate",
      "passportExpiryDate",
      "arrivalDate",
      "appointmentDate",
    ];
    for (const f of dateFields) {
      const v = form[f];
      if (v && !ddmmyyyyToIso(v)) {
        setError(`"${f}" must be a valid date in DD/MM/YYYY format.`);
        return;
      }
    }

    setSubmitting(true);

    if (pdfUrl) {
      URL.revokeObjectURL(pdfUrl);
      setPdfUrl("");
    }

    const payload: Tm7FormData = {
      title: form.title,
      firstName: form.firstName,
      lastName: form.lastName,
      nationality: form.nationality,
      dateOfBirth: ddmmyyyyToIso(form.dateOfBirth),
      placeOfBirth: form.placeOfBirth || undefined,
      passportNo: form.passportNo,
      passportIssueDate: ddmmyyyyToIso(form.passportIssueDate),
      passportExpiryDate: ddmmyyyyToIso(form.passportExpiryDate),
      passportIssuedAt: form.passportIssuedAt || undefined,
      arrivalDate: ddmmyyyyToIso(form.arrivalDate),
      fromCountry: form.fromCountry || undefined,
      portOfArrival: form.portOfArrival || undefined,
      arrivedBy: form.arrivedBy || undefined,
      visaType: form.visaType || undefined,
      houseNo: form.houseNo || undefined,
      road: form.road || undefined,
      subDistrict: form.subDistrict || undefined,
      district: form.district || undefined,
      province: form.province || undefined,
      postalCode: form.postalCode || undefined,
      phone: form.phone || undefined,
      appointmentDate: ddmmyyyyToIso(form.appointmentDate),
      formLocation: form.formLocation || undefined,
      extensionDays: form.extensionDays ? Number(form.extensionDays) : undefined,
      extensionReason: form.extensionReason || undefined,
    };

    try {
      const body = new FormData();
      body.append("payload", JSON.stringify(payload));
      if (tm30File) body.append("tm30", tm30File);

      const res = await fetch("/api/generate-tm7", {
        method: "POST",
        body,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPdfUrl(url);

      setTimeout(() => {
        previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 100);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate PDF");
    } finally {
      setSubmitting(false);
    }
  }

  function handleDownload() {
    if (!pdfUrl) return;
    const a = document.createElement("a");
    a.href = pdfUrl;
    a.download = buildTm7Filename(form.lastName, form.firstName);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function handlePrint() {
    if (!pdfUrl) return;
    const w = window.open(pdfUrl, "_blank");
    if (w) {
      w.addEventListener("load", () => w.print(), { once: true });
    }
  }

  function handleReset() {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl("");
    setForm({ ...INITIAL, appointmentDate: todayDdmmyyyy() });
    setError("");
    setScanWarning("");
    setTm30Message(null);
    setTm30File(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          TM.7 Visa Extension Form
        </h1>
        <p className="mt-2 text-sm text-slate-600">
          Fill in your details below and generate a printable TM.7 packet (5 pages: TM.7, STM.2, STM.9, STM.11).
        </p>
      </header>

      <section className="mb-6 rounded-2xl border border-violet-200 bg-violet-50/60 p-5">
        <h2 className="text-sm font-semibold text-violet-900">Quick fill with AI</h2>
        <p className="mb-4 text-xs text-violet-700/80">
          Upload a passport bio page or TM.30 PDF. Gemini extracts the details and fills the form for you.
        </p>
        <div className="space-y-4">
          <AiPassportScanner onScan={handleAiScan} onError={handleScanError} />
          <AiTm30Scanner onScan={handleTm30Scan} onError={handleTm30Error} />
        </div>
        <p className="mt-3 text-xs text-violet-700/70">
          A scan not working, or a button not responding? Refresh the page to load the
          latest version, then try again.
        </p>
        {scanWarning && (
          <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            {scanWarning}
          </div>
        )}
        {tm30Message && (
          <div
            className={`mt-3 rounded-lg border px-3 py-2 text-xs ${
              tm30Message.type === "success"
                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : "border-amber-300 bg-amber-50 text-amber-800"
            }`}
          >
            {tm30Message.text}
          </div>
        )}
      </section>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Section title="Personal Information" subtitle="As shown in your passport">
          <Field label="Title" thai="คำนำหน้า" required>
            <select
              value={form.title}
              onChange={(e) => set("title", e.target.value as Title)}
              className={inputCls}
            >
              <option value="MR.">Mr.</option>
              <option value="MRS.">Mrs.</option>
              <option value="MISS">Miss</option>
            </select>
          </Field>
          <Field label="First Name" thai="ชื่อ" required>
            <input
              type="text"
              required
              value={form.firstName}
              onChange={(e) => set("firstName", e.target.value)}
              placeholder="JOHN"
              className={inputCls}
            />
          </Field>
          <Field label="Last Name" thai="นามสกุล" required>
            <input
              type="text"
              required
              value={form.lastName}
              onChange={(e) => set("lastName", e.target.value)}
              placeholder="DOE"
              className={inputCls}
            />
          </Field>
          <Field label="Nationality" thai="สัญชาติ" required>
            <input
              type="text"
              required
              value={form.nationality}
              onChange={(e) => set("nationality", e.target.value)}
              placeholder="BRITISH"
              className={inputCls}
            />
          </Field>
          <Field label="Date of Birth" thai="วันเกิด">
            <DateInput
              value={form.dateOfBirth}
              onChange={(v) => set("dateOfBirth", v)}
            />
          </Field>
          <Field label="Place of Birth" thai="สถานที่เกิด">
            <input
              type="text"
              value={form.placeOfBirth}
              onChange={(e) => set("placeOfBirth", e.target.value)}
              placeholder="LONDON"
              className={inputCls}
            />
          </Field>
        </Section>

        <Section title="Passport" subtitle="From the bio page">
          <Field label="Passport Number" thai="หมายเลขหนังสือเดินทาง" required>
            <input
              type="text"
              required
              value={form.passportNo}
              onChange={(e) => set("passportNo", e.target.value.toUpperCase())}
              placeholder="AB1234567"
              className={inputCls}
            />
          </Field>
          <Field label="Issued At (country)" thai="ออกให้ที่ (ประเทศ)">
            <input
              type="text"
              value={form.passportIssuedAt}
              onChange={(e) => set("passportIssuedAt", e.target.value)}
              placeholder="UNITED KINGDOM"
              className={inputCls}
            />
          </Field>
          <Field label="Date of Issue" thai="วันที่ออก">
            <DateInput
              value={form.passportIssueDate}
              onChange={(v) => set("passportIssueDate", v)}
            />
          </Field>
          <Field label="Date of Expiry" thai="วันหมดอายุ">
            <DateInput
              value={form.passportExpiryDate}
              onChange={(v) => set("passportExpiryDate", v)}
            />
          </Field>
        </Section>

        <Section title="Arrival in Thailand" subtitle="From the latest entry stamp / TM.6">
          <Field label="Arrival Date" thai="วันที่เดินทางเข้า">
            <DateInput
              value={form.arrivalDate}
              onChange={(v) => set("arrivalDate", v)}
              highlight
            />
          </Field>
          <Field label="From (Country)" thai="เดินทางมาจาก (ประเทศ)">
            <input
              type="text"
              value={form.fromCountry}
              onChange={(e) => set("fromCountry", e.target.value)}
              placeholder="UNITED KINGDOM"
              className={inputCls}
            />
          </Field>
          <Field label="Port of Arrival" thai="ด่านที่เดินทางเข้า">
            <input
              type="text"
              value={form.portOfArrival}
              onChange={(e) => set("portOfArrival", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Arrived By" thai="เดินทางโดย">
            <input
              type="text"
              value={form.arrivedBy}
              onChange={(e) => set("arrivedBy", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Type of Visa" thai="ประเภทวีซ่า" full>
            <input
              type="text"
              value={form.visaType}
              onChange={(e) => set("visaType", e.target.value)}
              className={inputCls}
            />
          </Field>
        </Section>

        <Section title="Address in Thailand" subtitle="Where you are currently staying">
          <Field label="House No." thai="บ้านเลขที่">
            <input
              type="text"
              value={form.houseNo}
              onChange={(e) => set("houseNo", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Road / Street" thai="ถนน">
            <input
              type="text"
              value={form.road}
              onChange={(e) => set("road", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Sub-District (Tambol)" thai="ตำบล / แขวง">
            <input
              type="text"
              value={form.subDistrict}
              onChange={(e) => set("subDistrict", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="District (Amphur)" thai="อำเภอ / เขต">
            <input
              type="text"
              value={form.district}
              onChange={(e) => set("district", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Province" thai="จังหวัด">
            <input
              type="text"
              value={form.province}
              onChange={(e) => set("province", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Postal Code" thai="รหัสไปรษณีย์">
            <input
              type="text"
              value={form.postalCode}
              onChange={(e) => set("postalCode", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Phone" thai="เบอร์โทรศัพท์" full>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="+66 8x xxx xxxx"
              className={inputCls}
            />
          </Field>
        </Section>

        <Section title="Extension Request" subtitle="Details for the application">
          <Field label="Form Date (Appointment)" thai="วันที่ยื่นคำร้อง (นัดหมาย)">
            <DateInput
              value={form.appointmentDate}
              onChange={(v) => set("appointmentDate", v)}
              highlight
            />
          </Field>
          <Field label="Form Location" thai="สถานที่ยื่นคำร้อง">
            <input
              type="text"
              value={form.formLocation}
              onChange={(e) => set("formLocation", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Extension Days" thai="จำนวนวันที่ขอต่อ">
            <input
              type="number"
              min={1}
              max={365}
              value={form.extensionDays}
              onChange={(e) => set("extensionDays", e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label="Reason for Extension" thai="เหตุผลในการขอต่อ">
            <input
              type="text"
              value={form.extensionReason}
              onChange={(e) => set("extensionReason", e.target.value)}
              className={inputCls}
            />
          </Field>
        </Section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={handleReset}
            className="rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          >
            Reset
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            {submitting && (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            )}
            {submitting ? "Generating..." : "Generate TM.7 PDF"}
          </button>
        </div>
      </form>

      {pdfUrl && (
        <div ref={previewRef} className="mt-12 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">Preview</h2>
              <p className="text-sm text-slate-500">
                {tm30File
                  ? "6 pages: TM.7, STM.2, STM.9, STM.11, TM.30"
                  : "5 pages: TM.7, STM.2, STM.9, STM.11"}
              </p>
            </div>
            <div className="flex gap-2">
              {/* Print via window.open(blob).print() doesn't work on Android — hide it there. */}
              {!isAndroid && (
                <button
                  onClick={handlePrint}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Print
                </button>
              )}
              <button
                onClick={handleDownload}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
              >
                Download PDF
              </button>
            </div>
          </div>
          {isAndroid ? (
            // Android has no inline PDF viewer — offer clear open/download actions
            // instead of a blank iframe.
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
              <svg
                className="mx-auto h-10 w-10 text-emerald-600"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
                />
              </svg>
              <p className="mt-3 text-sm font-medium text-slate-900">
                PDF ของคุณพร้อมแล้ว
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500">
                เบราว์เซอร์บน Android ไม่รองรับการแสดง PDF ในหน้าเว็บโดยตรง
                กดปุ่มด้านล่างเพื่อเปิดหรือบันทึกไฟล์
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <a
                  href={pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  เปิด PDF ในแท็บใหม่
                </a>
                <button
                  onClick={handleDownload}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
                >
                  ดาวน์โหลด PDF
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <iframe
                src={pdfUrl}
                className="h-[80vh] w-full"
                title="Generated TM.7 PDF"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const inputBase =
  "w-full rounded-lg border px-3.5 py-2.5 text-sm transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 focus:outline-none";
const inputCls = `${inputBase} border-slate-300 bg-white`;
// Yellow highlight for fields that always require manual entry (no AI/passport auto-fill).
const inputHighlightCls = `${inputBase} border-yellow-400 bg-yellow-100 font-semibold text-yellow-900 placeholder:font-normal placeholder:text-yellow-700/60`;

// The user's local date as DD/MM/YYYY — used to prefill the appointment field.
function todayDdmmyyyy(): string {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

// Auto-format raw digits as DD/MM/YYYY while typing (e.g. "01122024" → "01/12/2024")
function formatDateMask(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const dd = digits.slice(0, 2);
  const mm = digits.slice(2, 4);
  const yyyy = digits.slice(4, 8);
  if (digits.length <= 2) return dd;
  if (digits.length <= 4) return `${dd}/${mm}`;
  return `${dd}/${mm}/${yyyy}`;
}

// Convert "DD/MM/YYYY" → "YYYY-MM-DD" for the API. Returns undefined for empty or invalid.
function ddmmyyyyToIso(s: string): string | undefined {
  if (!s) return undefined;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return undefined;
  const [, dd, mm, yyyy] = m;
  const day = Number(dd), month = Number(mm), year = Number(yyyy);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return undefined;
  return `${yyyy}-${mm}-${dd}`;
}

function DateInput({
  value,
  onChange,
  highlight = false,
}: {
  value: string;
  onChange: (v: string) => void;
  highlight?: boolean;
}) {
  return (
    <input
      type="text"
      inputMode="numeric"
      value={value}
      onChange={(e) => onChange(formatDateMask(e.target.value))}
      placeholder="DD/MM/YYYY"
      maxLength={10}
      pattern="\d{2}/\d{2}/\d{4}"
      className={highlight ? inputHighlightCls : inputCls}
    />
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
      <div className="mb-5">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({
  label,
  thai,
  required,
  full,
  children,
}: {
  label: string;
  thai?: string;
  required?: boolean;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
        {thai && <span className="ml-1.5 text-xs font-normal text-green-600">{thai}</span>}
      </label>
      {children}
    </div>
  );
}
