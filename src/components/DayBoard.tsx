"use client";

// =============================================================
// DayBoard — the daily board behind /today (30-day extensions) and
// /visarun (visa runs by car). Same intake, photos, summary and
// bookkeeping; the mode switches the server namespace, the defaults,
// the per-person fields (run type / car / flight) and the car cards.
// =============================================================
// Drop every image the agents sent for the day; each is classified and
// read by Gemini, grouped into people (a passport starts a new person,
// the stamp / selfie / TM.30 that follow belong to that person), and the
// day can then be turned into TM.7 packets, the TM.30 upload Excel and a
// folder tree zip — all from one screen. State lives in IndexedDB.

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";
import { analyzeDoc, type AnalyzedDoc } from "@/app/actions/analyzeDoc";
import { analyzeTm30 } from "@/app/actions/analyzeTm30";
import { compressPdf } from "@/lib/compressPdf";
import type { Tm7FormData } from "@/lib/tm7-generator";
import {
  DEFAULT_META, DEFAULT_META_RUN, EMPTY_FIELDS, ddmmyyyyToIso, extensionExpiry, fmtDdmmyyyy, parseDdmmyyyy, runExpiry, loadHolidays, newId, overstayInfo, saveHolidays,
  personFolderName, todayDdmmyyyy,
  type DayMeta, type DocFile, type DocType, type Person, type PersonFields,
} from "@/lib/today/types";
import { daysStore, runStore } from "@/lib/today/store";
import { CARS, RUN_SLOTS, carById } from "@/lib/visarun/cars";
import CarCard from "@/components/CarCard";
import CollectCard from "@/components/CollectCard";
import RunDaySheet from "@/components/RunDaySheet";
import { DIRECT_CUSTOMER, MAIN_AGENTS } from "@/lib/today/agents";
import ExpiryReport, { thDate, zhDate, type ReportRow } from "@/components/ExpiryReport";
import { OFFICES, OFFICE_IDS, isOfficeId, type OfficeId } from "@/lib/offices";
import {
  billUrl, buildAgentExcel, buildCollectImage, buildDayZip, buildTm30Excel, downloadBlob, type RunSheetRow, downscaleImage, loadScript, mergePdfs, plusDaysDdmmyyyy,
} from "@/lib/today/clientTools";
import {
  DEFAULT_CROP, buildPhotoSheetPdf, cropPassportPhoto, drawCrop, findHeadByBackground, loadImage, renderPhoto,
  type Crop, type HeadBox,
} from "@/lib/today/photoTools";

// ---------- photo prompts (editable in the settings panel, kept in localStorage) ----------
const PROMPT_SELFIE_DEFAULT =
  "ปรับแสงภาพเดิม ให้เหมือนเป็นภาพถ่ายออกจากสตูดิโอ พื้นหลังสีขาว ด้วยกล้องคุณภาพสูง ภาพคนเดิมนะ ปรับภาพหน้าตรงเหมือนถ่ายรูปไปสมัครงาน ใส่เสื้อผ้าตัวเดิม แต่เพิ่มสัดส่วนของเสื้อผ้าให้มากขึ้นด้วยนะ สุภาพสีเดิม จัดเสื้อให้เรียบร้อยเหมือนรูปติดบัตร ลบกระเป๋าสะพาย สายกระเป๋า หมวก หูฟัง แว่นกันแดด และสิ่งของอื่นออกให้หมด เหลือแต่เสื้อ มุมกล้องหน้าตรง มองกล้อง ห้ามเห็นฟัน พื้นหลังสีขาวล้วนเรียบ ไม่มีเงา ไม่มีลวดลาย ภาพแนวตั้ง ครึ่งตัวบน เห็นหัวถึงไหล่ ตัวอยู่กลางภาพ";
const PROMPT_PASSPORT_DEFAULT =
  "แก้ไขรูปภาพ หน้าคนเดิม ขอทรงผม พื้นหลังขาว หน้าตรง นำรูปไปทำวีซ่า ห้ามเห็นฟัน ไม่ใส่แว่นตา ขอเพิ่มสัดส่วนให้มีเสื้อผ้าเยอะขึ้นด้วยนะ {เสื้อผ้า} พื้นหลังสีขาวล้วนเรียบ ไม่มีเงา ภาพแนวตั้ง ครึ่งตัวบน เห็นหัวถึงไหล่ ตัวอยู่กลางภาพ คมชัดเหมือนถ่ายในสตูดิโอ";
const CLOTHES_DEFAULT = "เสื้อยืดคอโปโลสีกรมท่า\nเสื้อยืดคอกลมสีดำ\nเสื้อยืดคอกลมสีขาว\nเสื้อเชิ้ตคอปกสีดำ\nเสื้อเชิ้ตคอปกสีขาว\nเสื้อยืดคอโปโลสีเทาเข้ม";

type PhotoSettings = { provider: "openai" | "gemini"; model: string; promptSelfie: string; promptPassport: string; clothes: string };
const PHOTO_SETTINGS_DEFAULT: PhotoSettings = { provider: "openai", model: "gpt-image-1.5", promptSelfie: PROMPT_SELFIE_DEFAULT, promptPassport: PROMPT_PASSPORT_DEFAULT, clothes: CLOTHES_DEFAULT };
function loadPhotoSettings(): PhotoSettings {
  try { return { ...PHOTO_SETTINGS_DEFAULT, ...JSON.parse(localStorage.getItem("today-photo-settings") || "{}") }; } catch { return { ...PHOTO_SETTINGS_DEFAULT }; }
}

const MAX_PDF_BYTES = 4 * 1024 * 1024;
const CONCURRENCY = 3;

export type BoardMode = "ext" | "run";

export default function DayBoard({ mode }: { mode: BoardMode }) {
  const isRun = mode === "run";
  const store = isRun ? runStore : daysStore;
  const DEFAULTS = isRun ? DEFAULT_META_RUN : DEFAULT_META;
  const { loadDay, flush, savePerson, deletePerson, saveMeta, listDays, movePersonToDay, movePersonToOffice, isLoading, isSaving, lastError: storeError, lastSavedAt, loadProgress } = store;
  const clearDayRemote = store.clearDay;
  const dayKey = isRun ? "tm7-open-day-run" : "tm7-open-day";
  const officeKey = dayKey + "-office";
  // the office is part of the board's address (date + office), not just a label on the day
  const officeRef = useRef<OfficeId>(DEFAULTS.office);
  const [people, setPeople] = useState<Person[]>([]);
  const [meta, setMeta] = useState<DayMeta>({ ...DEFAULTS });
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [photoSettings, setPhotoSettings] = useState<PhotoSettings>(PHOTO_SETTINGS_DEFAULT);
  const [showSettings, setShowSettings] = useState(false);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [days, setDays] = useState<{ date: string; files: number }[]>([]);
  const [saveState, setSaveState] = useState("");
  const [summaryBlob, setSummaryBlob] = useState<Blob | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const peopleRef = useRef<Person[]>([]);
  useEffect(() => { peopleRef.current = people; }, [people]);

  // ---------- load / persist ----------
  const openDay = useCallback(async (date: string, office?: OfficeId) => {
    const off = office ?? officeRef.current;
    officeRef.current = off;
    setLoaded(false);
    setStatus(`กำลังโหลดข้อมูลวัน ${date} · ${OFFICES[off].label}…`);
    setPeople([]);
    const { people: p, meta: m, stale } = await loadDay(date, off);
    if (stale) return; // user switched to another day meanwhile
    setPeople(p);
    // the office we navigated to always wins over whatever the saved meta says
    const merged = { ...DEFAULTS, ...(m ?? {}), date, office: off };
    if (!m || m.office !== off) { merged.jobType = OFFICES[off].short; merged.formLocation = OFFICES[off].formLocation; }
    setMeta(merged);
    setLoaded(true);
    setStatus(storeError() ? "โหลดจากเซิร์ฟเวอร์ไม่สำเร็จ: " + storeError() : "");
    try { sessionStorage.setItem(dayKey, date); sessionStorage.setItem(officeKey, off); } catch {}
    listDays().then(setDays);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    let initial = todayDdmmyyyy();
    let office: OfficeId = DEFAULTS.office;
    try {
      initial = sessionStorage.getItem(dayKey) || initial;
      const o = sessionStorage.getItem(officeKey);
      if (o && isOfficeId(o)) office = o;
    } catch {}
    void openDay(initial, office);
    setPhotoSettings(loadPhotoSettings());
    setHolidays(loadHolidays());
    const t = window.setInterval(() => setSaveState(isLoading() ? `กำลังโหลด… ${loadProgress()}` : isSaving() ? "กำลังบันทึก…" : storeError() ? storeError() : lastSavedAt() ? `บันทึกแล้ว ${new Date(lastSavedAt()).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}` : ""), 1000);
    const onLeave = () => { void flush(); };
    window.addEventListener("beforeunload", onLeave);
    return () => { window.clearInterval(t); window.removeEventListener("beforeunload", onLeave); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDay]);

  function updatePhotoSettings(patch: Partial<PhotoSettings>) {
    setPhotoSettings((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem("today-photo-settings", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function commitDate(v: string) {
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(v)) return;
    if (v !== metaRefDate.current) { void flush().then(() => openDay(v)); }
  }
  const metaRefDate = useRef("");
  useEffect(() => { if (loaded) metaRefDate.current = meta.date; }, [meta.date, loaded]);
  const calendarRef = useRef<HTMLInputElement>(null);
  function openCalendar() {
    const el = calendarRef.current;
    if (!el) return;
    const withPicker = el as HTMLInputElement & { showPicker?: () => void };
    try { withPicker.showPicker ? withPicker.showPicker() : el.click(); } catch { el.click(); }
  }
  // DD/MM/YYYY <-> YYYY-MM-DD for the native date picker
  const toIso = (d: string) => (/^\d{2}\/\d{2}\/\d{4}$/.test(d) ? `${d.slice(6, 10)}-${d.slice(3, 5)}-${d.slice(0, 2)}` : "");
  const fromIso = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v.slice(8, 10)}/${v.slice(5, 7)}/${v.slice(0, 4)}` : "");
  function shiftDay(delta: number) {
    const [dd, mm, yy] = metaRefDate.current.split("/").map(Number);
    const d = new Date(yy, mm - 1, dd);
    d.setDate(d.getDate() + delta);
    commitDate(`${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`);
  }

  function changeOffice(office: OfficeId) {
    if (office === officeRef.current) return;
    // each office is its own board for the day: save this one, then open the other
    void flush().then(() => openDay(metaRefDate.current || meta.date, office));
  }

  function updateMeta(patch: Partial<DayMeta>) {
    setMeta((prev) => {
      const next = { ...prev, ...patch };
      saveMeta(next);
      return next;
    });
  }

  const upsertPerson = useCallback((p: Person) => {
    setPeople((prev) => {
      const i = prev.findIndex((x) => x.id === p.id);
      const next = i >= 0 ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p];
      next.sort((a, b) => a.order - b.order);
      return next;
    });
    savePerson(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function patchPerson(id: string, fn: (p: Person) => Person) {
    const cur = peopleRef.current.find((x) => x.id === id);
    if (!cur) return;
    upsertPerson(fn(cur));
  }

  function removePerson(id: string) {
    setPeople((prev) => prev.filter((x) => x.id !== id));
    deletePerson(id);
  }

  const active = people.filter((p) => !p.cancelled && !p.movedTo);

  async function moveDay(p: Person) {
    const [dd, mm, yy] = meta.date.split("/").map(Number);
    const d = new Date(yy, mm - 1, dd); d.setDate(d.getDate() + 1);
    const def = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    const target = window.prompt(`ย้าย ${personFolderName(p)} ไปวันที่ (DD/MM/YYYY)`, def);
    if (!target || !/^\d{2}\/\d{2}\/\d{4}$/.test(target) || target === meta.date) return;
    setWorking(true); setStatus(`กำลังย้ายไปวัน ${target}…`);
    try {
      await movePersonToDay(p, target);
      setPeople((prev) => prev.map((x) => (x.id === p.id ? { ...x, movedTo: target, arrived: false } : x)));
      setStatus(`ย้าย ${personFolderName(p)} ไปวัน ${target} แล้ว`);
      listDays().then(setDays);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setStatus(""); }
    finally { setWorking(false); }
  }
  async function moveOffice(p: Person, office: OfficeId) {
    if (office === meta.office) return;
    if (!window.confirm(`ย้าย ${personFolderName(p)} ไปหน้างาน ${OFFICES[office].label} (วัน ${meta.date})?\nTM7 PDF เดิมจะถูกทิ้ง ต้องกดทำใหม่ที่หน้างานใหม่`)) return;
    setWorking(true); setStatus(`กำลังย้ายไป ${OFFICES[office].label}…`);
    try {
      await movePersonToOffice(p, office);
      setPeople((prev) => prev.filter((x) => x.id !== p.id));
      setStatus(`ย้าย ${personFolderName(p)} ไป ${OFFICES[office].label} แล้ว`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setStatus(""); }
    finally { setWorking(false); }
  }
  function openOverstayCalc(p: Person) {
    const f = p.fields;
    const q = new URLSearchParams();
    if (f.admittedUntil) q.set("until", f.admittedUntil);
    else if (f.arrivalDate) {
      q.set("entry", f.arrivalDate);
      const v = (f.visaType || "").toUpperCase();
      q.set("type", /VOA|ON ARRIVAL/.test(v) ? "15" : /\bTR\b|TOURIST/.test(v) ? "60t" : /NON/.test(v) ? "90" : /30/.test(v) ? "30" : "60");
    }
    if (meta.extensionDays) q.set("ext", meta.extensionDays);
    q.set("name", [f.lastName, f.firstName].filter(Boolean).join(" "));
    if (f.chineseName) q.set("zh", f.chineseName);
    q.set("check", meta.date);
    window.open(`/tools/overstay.html?${q.toString()}`, "_blank");
  }
  function toggleArrived(p: Person) {
    patchPerson(p.id, (x) => ({ ...x, arrived: !x.arrived }));
  }
  function toggleCancelled(p: Person) {
    patchPerson(p.id, (x) => ({ ...x, cancelled: !x.cancelled }));
  }

  // New person defaults: on the extension board everyone starts ticked for the
  // evening expiry report (untick the few who shouldn't be in it); on the
  // visa-run board the factory group is ticked by hand / by agent.
  function freshFields(): PersonFields {
    return { ...EMPTY_FIELDS, report: !isRun };
  }

  function nextOrder(): number {
    return peopleRef.current.reduce((m, p) => Math.max(m, p.order), 0) + 1;
  }

  function addEmptyPerson(): Person {
    const p: Person = { id: newId(), order: nextOrder(), fields: freshFields(), files: [], createdAt: Date.now() };
    upsertPerson(p);
    return p;
  }

  // ---------- intake ----------
  async function handleFiles(fileList: FileList | File[]) {
    const files = [...fileList]
      .filter((f) => f.type.startsWith("image/") || /\.pdf$/i.test(f.name) || f.type === "application/pdf")
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!files.length) return;
    setError("");
    setWorking(true);

    // 1) downscale + register every file first (so the user sees them immediately)
    type Pending = { doc: DocFile; file: File; result?: AnalyzedDoc; address?: Partial<PersonFields>; tm30Who?: { firstName: string; lastName: string; passportNo: string } };
    const pending: Pending[] = [];
    for (const f of files) {
      const isPdf = f.type === "application/pdf" || /\.pdf$/i.test(f.name);
      let blob: Blob = f;
      if (isPdf) {
        if (f.size > MAX_PDF_BYTES) {
          try { blob = await compressPdf(f); } catch { blob = f; }
        }
      } else {
        blob = await downscaleImage(f);
      }
      // Copy the bytes into a plain Blob: a File stored in IndexedDB keeps
      // pointing at the file on disk, and reading it later fails with
      // NotReadableError once the OS handle is gone (e.g. after a reload).
      blob = new Blob([await blob.arrayBuffer()], { type: isPdf ? "application/pdf" : "image/jpeg" });
      pending.push({
        doc: { id: newId(), kind: isPdf ? "tm30" : "other", name: f.name, mime: isPdf ? "application/pdf" : "image/jpeg", blob, status: "queued" },
        file: f,
      });
    }

    // 2) analyze with limited concurrency
    let done = 0;
    const queue = [...pending];
    async function worker() {
      while (queue.length) {
        const item = queue.shift()!;
        item.doc.status = "analyzing";
        try {
          if (item.doc.mime === "application/pdf") {
            if (item.doc.blob.size > MAX_PDF_BYTES) throw new Error("PDF ใหญ่เกิน 4 MB หลังบีบอัด");
            const fd = new FormData();
            fd.append("document", new File([item.doc.blob], item.file.name, { type: "application/pdf" }));
            const r = await analyzeTm30(fd);
            if (!r.ok) throw new Error(r.error);
            item.address = r.data;
            item.tm30Who = { firstName: r.data.firstName, lastName: r.data.lastName, passportNo: r.data.passportNo };
            item.doc.kind = "tm30";
          } else {
            const fd = new FormData();
            fd.append("image", new File([item.doc.blob], item.file.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg" }));
            const r = await analyzeDoc(fd);
            if (!r.ok) throw new Error(r.error);
            item.result = r.data;
            item.doc.kind = r.data.docType;
            if (r.data.docType === "passport" && r.data.photoBox) item.doc.photoBox = r.data.photoBox;
            if (r.data.docType === "tm30") item.address = pickAddress(r.data);
          }
          item.doc.status = "done";
        } catch (e) {
          item.doc.status = "error";
          item.doc.error = e instanceof Error ? e.message : String(e);
        }
        done++;
        setStatus(`กำลังอ่านรูป ${done}/${pending.length}`);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker));

    // 3) group into people, in filename order: passport = new person; the
    //    files after it belong to that person until the next passport.
    let current: Person | null = null;
    const touched = new Map<string, Person>();
    const existing = () => [...peopleRef.current.filter((p) => !touched.has(p.id)), ...touched.values()];

    for (const item of pending) {
      const d = item.result;
      if (item.doc.kind === "passport" && d) {
        const byNo = d.passportNo ? existing().find((p) => p.fields.passportNo && p.fields.passportNo === d.passportNo) : undefined;
        const base: Person = byNo ?? { id: newId(), order: nextOrder() + touched.size, fields: freshFields(), files: [], createdAt: Date.now() };
        current = applyPassport(base, d);
        current = { ...current, files: [...current.files, item.doc] };
        touched.set(current.id, current);
        continue;
      }
      // TM.30 receipts: match by the passport number printed on the receipt,
      // then by the name on the receipt, then by the filename; a receipt that
      // matches nobody becomes its own person (a later passport scan with the
      // same number merges into it).
      let target: Person | null = null;
      if (item.doc.kind === "tm30") {
        const who = item.tm30Who;
        if (who?.passportNo) target = existing().find((p) => p.fields.passportNo === who.passportNo) ?? null;
        const nameTokens = [
          ...(who ? `${who.firstName} ${who.lastName}` : "").toUpperCase().split(/[^A-Z]+/),
          ...item.file.name.toUpperCase().replace(/\.[^.]+$/, "").split(/[^A-Z]+/),
        ].filter((t) => t.length > 1 && t !== "TM" && t !== "PDF");
        if (!target && nameTokens.length) {
          target = existing().find((p) => {
            const own = `${p.fields.firstName} ${p.fields.lastName}`.toUpperCase().split(/[^A-Z]+/).filter(Boolean);
            return own.length > 0 && own.every((t) => nameTokens.includes(t));
          }) ?? null;
        }
        if (!target) {
          target = { id: newId(), order: nextOrder() + touched.size, fields: { ...freshFields(), firstName: who?.firstName ?? "", lastName: who?.lastName ?? "", passportNo: who?.passportNo ?? "" }, files: [], createdAt: Date.now() };
        }
      }
      if (!target) target = current ?? existing().slice(-1)[0] ?? null;
      if (!target) {
        target = { id: newId(), order: nextOrder() + touched.size, fields: freshFields(), files: [], createdAt: Date.now() };
      }
      let next: Person = { ...target, files: [...target.files, item.doc] };
      if (item.doc.kind === "stamp" && d) next = applyStamp(next, d);
      if (item.address) next = applyAddress(next, item.address);
      touched.set(next.id, next);
      if (current && current.id === next.id) current = next;
    }

    for (const p of touched.values()) upsertPerson(p);
    const errs = pending.filter((x) => x.doc.status === "error").length;
    setStatus(errs ? `อ่านเสร็จ มี ${errs} ไฟล์อ่านไม่ได้ (ดูป้ายแดงในการ์ด)` : `อ่านเสร็จ ${pending.length} ไฟล์`);
    setWorking(false);
  }

  function applyPassport(p: Person, d: AnalyzedDoc): Person {
    const f = p.fields;
    return {
      ...p,
      fields: {
        ...f,
        title: (d.title || f.title) as PersonFields["title"],
        firstName: d.firstName || f.firstName,
        lastName: d.lastName || f.lastName,
        chineseName: d.chineseName || f.chineseName,
        nationality: d.nationality || f.nationality,
        dateOfBirth: d.dateOfBirth || f.dateOfBirth,
        placeOfBirth: d.placeOfBirth || f.placeOfBirth,
        passportNo: d.passportNo || f.passportNo,
        passportIssueDate: d.passportIssueDate || f.passportIssueDate,
        passportExpiryDate: d.passportExpiryDate || f.passportExpiryDate,
        passportIssuedAt: d.passportIssuedAt || f.passportIssuedAt,
      },
    };
  }
  function applyStamp(p: Person, d: AnalyzedDoc): Person {
    const f = p.fields;
    return {
      ...p,
      fields: {
        ...f,
        arrivalDate: d.arrivalDate || f.arrivalDate,
        admittedUntil: d.admittedUntil || f.admittedUntil,
        portOfArrival: d.portOfArrival || f.portOfArrival,
        arrivedBy: d.arrivedBy || f.arrivedBy,
      },
    };
  }
  function pickAddress(a: AnalyzedDoc): Partial<PersonFields> {
    return { houseNo: a.houseNo, road: a.road, subDistrict: a.subDistrict, district: a.district, province: a.province, postalCode: a.postalCode };
  }
  function applyAddress(p: Person, a: Partial<PersonFields>): Person {
    const f = p.fields;
    return {
      ...p,
      fields: {
        ...f,
        houseNo: a.houseNo || f.houseNo,
        road: a.road || f.road,
        subDistrict: a.subDistrict || f.subDistrict,
        district: a.district || f.district,
        province: a.province || f.province,
        postalCode: a.postalCode || f.postalCode,
      },
    };
  }

  // ---------- TM.7 ----------
  async function generateTm7(p: Person): Promise<Blob> {
    const f = p.fields;
    const payload: Tm7FormData = {
      title: f.title,
      firstName: f.firstName,
      lastName: f.lastName,
      nationality: f.nationality,
      dateOfBirth: ddmmyyyyToIso(f.dateOfBirth),
      placeOfBirth: f.placeOfBirth || undefined,
      passportNo: f.passportNo,
      passportIssueDate: ddmmyyyyToIso(f.passportIssueDate),
      passportExpiryDate: ddmmyyyyToIso(f.passportExpiryDate),
      passportIssuedAt: f.passportIssuedAt || undefined,
      arrivalDate: ddmmyyyyToIso(f.arrivalDate),
      fromCountry: f.fromCountry || undefined,
      portOfArrival: f.portOfArrival || undefined,
      arrivedBy: f.arrivedBy || undefined,
      visaType: f.visaType || undefined,
      houseNo: f.houseNo || undefined,
      road: f.road || undefined,
      subDistrict: f.subDistrict || undefined,
      district: f.district || undefined,
      province: f.province || undefined,
      postalCode: f.postalCode || undefined,
      phone: f.phone || undefined,
      appointmentDate: ddmmyyyyToIso(meta.date),
      formLocation: meta.formLocation || undefined,
      extensionDays: meta.extensionDays ? Number(meta.extensionDays) : undefined,
      extensionReason: meta.extensionReason || undefined,
    };
    const payloadWithOffice = { ...payload, office: meta.office };
    const body = new FormData();
    body.append("payload", JSON.stringify(payloadWithOffice));
    const tm30 = p.files.find((x) => x.kind === "tm30" && x.mime === "application/pdf");
    if (tm30) body.append("tm30", new File([tm30.blob], "tm30.pdf", { type: "application/pdf" }));
    const res = await fetch("/api/generate-tm7", { method: "POST", body });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(errBody.error || `HTTP ${res.status}`);
    }
    return res.blob();
  }

  async function tm7One(p: Person, open = true) {
    setError("");
    try {
      const blob = await generateTm7(p);
      patchPerson(p.id, (x) => ({ ...x, tm7Pdf: blob }));
      if (open) window.open(URL.createObjectURL(blob), "_blank");
    } catch (e) {
      setError(`${personFolderName(p)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Which people need a TM.7 packet: everyone on the extension board (when the
  // office has a generator); on the visa-run board only "run + 30 days".
  const needsTm7 = (p: Person) => OFFICES[meta.office].generator !== "none" && (!isRun || p.fields.run === "RUN30");

  // Day outputs (TM7 packet, TM30 Excel, photo sheet, zip) are cut into
  // batches of at most BATCH people, in board order, so a big day prints and
  // files in manageable pieces: "ชุด1 (01-20)", "ชุด2 (21-40)", …
  const BATCH = 20;
  type Batch = { k: number; from: number; to: number; people: Person[] };
  // batches are cut on the board (active people, in order) so membership is
  // stable: person 21 is always in batch 2 whatever filter a button applies
  const allBatches: Batch[] = [];
  for (let i = 0; i < active.length; i += BATCH) allBatches.push({ k: allBatches.length, from: i + 1, to: Math.min(i + BATCH, active.length), people: active.slice(i, i + BATCH) });
  // which batch the output buttons work on: a specific one, or everything
  const [batchSel, setBatchSel] = useState<number | "all">("all");
  const selBatches = batchSel === "all" ? allBatches : allBatches.filter((b) => b.k === batchSel);
  // apply a button's own readiness filter inside the chosen batch(es)
  function groupsFor(filter: (p: Person) => boolean): Batch[] {
    return selBatches.map((b) => ({ ...b, people: b.people.filter(filter) })).filter((b) => b.people.length);
  }
  // file-name tag: "" when the day fits in one batch
  const tagOf = (b: Batch) => (allBatches.length <= 1 ? "" : `_ชุด${b.k + 1}(${String(b.from).padStart(2, "0")}-${String(b.to).padStart(2, "0")})`);
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function tm7All() {
    const groups = groupsFor((p) => needsTm7(p) && !!p.fields.firstName && !!p.fields.lastName && !!p.fields.passportNo);
    const total = groups.reduce((n, b) => n + b.people.length, 0);
    if (!total) { setError(isRun ? "ยังไม่มีคน 'ไปต่อ 30 วัน' ที่ข้อมูลครบ (ชื่อ นามสกุล เลขพาสปอร์ต)" : "ยังไม่มีคนที่ข้อมูลครบ (ชื่อ นามสกุล เลขพาสปอร์ต)"); return; }
    setWorking(true); setError("");
    try {
      let done = 0;
      for (const b of groups) {
        const blobs: Blob[] = [];
        for (const p of b.people) {
          done++;
          setStatus(`กำลังทำ TM7 ${done}/${total} — ${personFolderName(p)}`);
          const blob = await generateTm7(p);
          patchPerson(p.id, (x) => ({ ...x, tm7Pdf: blob }));
          blobs.push(blob);
        }
        setStatus(allBatches.length > 1 ? `กำลังรวม PDF ชุด ${b.k + 1}…` : "กำลังรวม PDF…");
        const merged = await mergePdfs(blobs);
        downloadBlob(merged, `TM7-${meta.jobType}-${meta.date.replace(/\//g, "")}-${b.people.length}คน${tagOf(b)}.pdf`);
        if (groups.length > 1) await pause(400);
      }
      setStatus(allBatches.length > 1 ? `TM7 ${total} คน · ${groups.map((b) => `ชุด ${b.k + 1}`).join(", ")}` : `TM7 ครบ ${total} คน รวมเป็นไฟล์เดียวแล้ว`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  // ---------- photos ----------
  function clothesList(): string[] {
    return photoSettings.clothes.split("\n").map((x) => x.trim()).filter(Boolean);
  }

  async function makePhoto(p: Person): Promise<Person> {
    const selfie = p.files.find((x) => x.kind === "selfie");
    const passport = p.files.find((x) => x.kind === "passport");
    let source: Blob;
    let mode: "selfie" | "passport";
    let cloth = p.cloth || "";
    if (selfie) { source = selfie.blob; mode = "selfie"; }
    else if (passport) {
      source = await cropPassportPhoto(passport.blob, passport.photoBox || "");
      mode = "passport";
      if (!cloth) { const list = clothesList(); cloth = list[Math.floor(Math.random() * list.length)] || ""; }
    } else throw new Error("ไม่มีเซลฟี่หรือพาสปอร์ตให้ทำรูป");
    const base = mode === "selfie" ? photoSettings.promptSelfie : photoSettings.promptPassport.replace("{เสื้อผ้า}", cloth);
    const prompt = p.photoExtra ? `${base} ${p.photoExtra}` : base;
    const body = new FormData();
    body.append("image", new File([source], "in.jpg", { type: "image/jpeg" }));
    body.append("prompt", prompt);
    body.append("provider", photoSettings.provider);
    body.append("model", photoSettings.model);
    const res = await fetch("/api/make-photo", { method: "POST", body });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
      throw new Error(errBody.error || `HTTP ${res.status}`);
    }
    const aiPhoto = await res.blob();
    const photo = await renderPhoto(aiPhoto, DEFAULT_CROP);
    return { ...p, aiPhoto, photo, crop: { ...DEFAULT_CROP }, photoMode: mode, cloth };
  }

  async function photoOne(p: Person) {
    setError("");
    setStatus(`กำลังทำรูป ${personFolderName(p)}… (20–50 วินาที)`);
    try {
      const next = await makePhoto(p);
      upsertPerson({ ...next, files: peopleRef.current.find((x) => x.id === p.id)?.files ?? next.files });
      setStatus("");
    } catch (e) {
      setError(`${personFolderName(p)}: ${e instanceof Error ? e.message : String(e)}`);
      setStatus("");
    }
  }

  async function photosAll() {
    const todo = active.filter((p) => !p.photo && p.files.some((x) => x.kind === "selfie" || x.kind === "passport"));
    if (!todo.length) { setStatus("ทุกคนมีรูปแล้ว"); return; }
    setWorking(true); setError("");
    let done = 0;
    const queue = [...todo];
    const failures: string[] = [];
    async function worker() {
      while (queue.length) {
        const p = queue.shift()!;
        try {
          const next = await makePhoto(p);
          upsertPerson({ ...next, files: peopleRef.current.find((x) => x.id === p.id)?.files ?? next.files });
        } catch (e) {
          failures.push(`${personFolderName(p)}: ${e instanceof Error ? e.message : String(e)}`);
        }
        done++;
        setStatus(`ทำรูปแล้ว ${done}/${todo.length}`);
      }
    }
    await Promise.all(Array.from({ length: Math.min(2, todo.length) }, worker));
    if (failures.length) setError(failures.join(" · "));
    setStatus(`ทำรูปเสร็จ ${todo.length - failures.length}/${todo.length} คน`);
    setWorking(false);
  }

  async function usePhotoAsIs(p: Person, fileId: string) {
    const f = p.files.find((x) => x.id === fileId);
    if (!f || f.mime === "application/pdf") return;
    setError("");
    try {
      const photo = await renderPhoto(f.blob, DEFAULT_CROP);
      patchPerson(p.id, (x) => ({ ...x, aiPhoto: f.blob, photo, crop: { ...DEFAULT_CROP }, photoMode: "selfie" }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  function updateCrop(id: string, crop: Crop, photo: Blob) {
    patchPerson(id, (x) => ({ ...x, crop, photo }));
  }

  async function photoSheet(): Promise<Blob | null> {
    const photos = active.filter((p) => p.photo).map((p) => p.photo as Blob);
    if (!photos.length) return null;
    return buildPhotoSheetPdf(photos);
  }
  async function downloadPhotoSheet() {
    setError("");
    try {
      const groups = groupsFor((p) => !!p.photo);
      if (!groups.length) { setError("ยังไม่มีรูปพื้นขาวของใครเลย"); return; }
      for (const b of groups) {
        const blob = await buildPhotoSheetPdf(b.people.map((p) => p.photo as Blob));
        downloadBlob(blob, `photo-sheet_${meta.date.replace(/\//g, "")}${tagOf(b)}.pdf`);
        if (groups.length > 1) await pause(400);
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  // Summary can be drawn for everyone or for one main agent only (the agent
  // then gets a picture with just their customers, each labelled with the
  // sub-agent note they gave us).
  const [summaryAgent, setSummaryAgent] = useState("");
  const summaryAgents = Array.from(new Set(active.map((p) => p.fields.agent).filter(Boolean)));
  async function makeSummary(): Promise<Blob | null> {
    const el = summaryRef.current;
    if (!el || !people.length) return null;
    // html-to-image renders through the browser's own layout engine (SVG
    // foreignObject), so Thai text and pills come out exactly as on screen —
    // html2canvas re-implements layout and sat Thai glyphs too low.
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js");
    const hti = (window as unknown as { htmlToImage: { toBlob: (el: HTMLElement, o: Record<string, unknown>) => Promise<Blob | null> } }).htmlToImage;
    const blob = await hti.toBlob(el, { pixelRatio: 2, cacheBust: false, backgroundColor: "#ffffff" });
    if (blob) setSummaryBlob(blob);
    return blob;
  }
  async function downloadSummary() {
    setError("");
    try {
      const blob = await makeSummary();
      if (!blob) return;
      downloadBlob(blob, `summary_${meta.date.replace(/\//g, "")}_${meta.jobType}${summaryAgent ? "_" + summaryAgent : ""}.png`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }
  // one summary per main agent: switch the filter, let React paint, capture, repeat
  async function makeAgentSummaries(): Promise<{ name: string; blob: Blob }[]> {
    const out: { name: string; blob: Blob }[] = [];
    const prev = summaryAgent;
    for (const a of summaryAgents) {
      setSummaryAgent(a);
      await new Promise((r) => setTimeout(r, 400));
      const blob = await makeSummary();
      if (blob) out.push({ name: `summary-${a.replace(/[\\/:*?"<>|]+/g, "_")}.png`, blob });
    }
    setSummaryAgent(prev);
    return out;
  }
  async function downloadAgentSummaries() {
    setError("");
    if (!summaryAgents.length) { setError("ยังไม่มีใครใส่ชื่อเอเจนซี่"); return; }
    setWorking(true); setStatus("กำลังทำ summary แยกเอเจนซี่…");
    try {
      const list = await makeAgentSummaries();
      for (const s of list) { downloadBlob(s.blob, `${meta.date.replace(/\//g, "")}_${s.name}`); await new Promise((r) => setTimeout(r, 300)); }
      setStatus(`summary ${list.length} เอเจนซี่`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setStatus(""); }
    finally { setWorking(false); }
  }

  // ---------- visa-run car cards (one PNG per car) ----------
  const carRefs = useRef<Record<string, HTMLDivElement | null>>({});          // customer cards
  const driverRefs = useRef<Record<string, HTMLDivElement | null>>({});       // driver cards (rendered off-screen)
  const [carView, setCarView] = useState<"customer" | "driver">("customer");
  const carsInUse = CARS.filter((c) => active.some((p) => p.fields.car === c.id));
  const unassigned = active.filter((p) => !p.fields.car);
  async function makeCarCards(which: ("customer" | "driver")[] = ["customer", "driver"]): Promise<{ name: string; blob: Blob }[]> {
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js");
    const hti = (window as unknown as { htmlToImage: { toBlob: (el: HTMLElement, o: Record<string, unknown>) => Promise<Blob | null> } }).htmlToImage;
    const out: { name: string; blob: Blob }[] = [];
    for (const v of which) {
      for (const c of carsInUse) {
        const el = (v === "driver" ? driverRefs : carRefs).current[c.id];
        if (!el) continue;
        const blob = await hti.toBlob(el, { pixelRatio: 2, cacheBust: false, backgroundColor: "#ffffff" });
        if (blob) out.push({ name: `car-${c.id}-${c.plate.replace(/\s+/g, "")}-${v === "driver" ? "คนขับ" : "ลูกค้า"}.png`, blob });
      }
    }
    return out;
  }
  async function downloadCarCards(which: "customer" | "driver") {
    setError("");
    if (!carsInUse.length) { setError("ยังไม่ได้จัดใครลงรถเลย — เลือกคันในการ์ดแต่ละคนก่อน"); return; }
    setWorking(true); setStatus(which === "driver" ? "กำลังทำการ์ดคนขับ…" : "กำลังทำการ์ดลูกค้า…");
    try {
      const cards = await makeCarCards([which]);
      for (const c of cards) { downloadBlob(c.blob, `${meta.date.replace(/\//g, "")}_${c.name}`); await new Promise((r) => setTimeout(r, 300)); }
      setStatus(`การ์ดรถ ${cards.length} คัน`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setStatus(""); }
    finally { setWorking(false); }
  }

  // ---------- visa-run day sheet for the checkpoint partner (Excel, rows tinted per car) ----------
  const runSheetRef = useRef<HTMLDivElement>(null);
  const [runSheetRows, setRunSheetRows] = useState<RunSheetRow[] | null>(null);
  async function runDaySheet() {
    if (!active.length) { setError("ยังไม่มีคนในบอร์ด"); return; }
    setError(""); setWorking(true); setStatus("กำลังทำตารางส่งด่าน…");
    try {
      const rows: RunSheetRow[] = active.map((p) => {
        const f = p.fields;
        const car = carById(f.car);
        const ov = overstayInfo(f.arrivalDate, f.admittedUntil, f.visaType, meta.date, holidays, false);
        const detail = [f.run === "RUN30" ? "ต่ออายุ 30 วัน" : "", ov && ov.days > 0 ? `อยู่เกิน ${ov.days} วัน` : ""].filter(Boolean).join("+");
        const e = expiryOf(p);
        const cashAtDriver = f.pay === "collect" && f.paidHow !== "transfer" && f.paidHow !== "agent" ? Number(f.amount) || 0 : 0;
        return {
          name: [f.lastName, f.firstName].filter(Boolean).join(" "),
          flight: f.flight || meta.flight || "", land: f.landTime || meta.landTime || "", returnBy: f.returnBy || meta.returnBy || "",
          expiry: e.expiry ? fmtDdmmyyyy(e.expiry) : "",
          carId: f.car || "", carLabel: car ? `${car.color} ${car.plate.replace(/\D/g, "")}` : "",
          detail, bear: !!f.cambodia, cash: cashAtDriver,
        };
      });
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js");
      const hti = (window as unknown as { htmlToImage: { toBlob: (el: HTMLElement, o: Record<string, unknown>) => Promise<Blob | null> } }).htmlToImage;
      setRunSheetRows(rows);
      await new Promise((r) => setTimeout(r, 450));
      const blob = runSheetRef.current ? await hti.toBlob(runSheetRef.current, { pixelRatio: 2, cacheBust: false, backgroundColor: "#ffffff" }) : null;
      if (!blob) throw new Error("สร้างรูปตารางไม่สำเร็จ");
      downloadBlob(blob, `visarun_${meta.date.replace(/\//g, "")}_ส่งด่าน.png`);
      setStatus("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setStatus(""); }
    finally { setRunSheetRows(null); setWorking(false); }
  }

  // ---------- visa-run expiry report (sent back to the factory / agent in the evening) ----------
  const reportRef = useRef<HTMLDivElement>(null);
  const reportPeople = active.filter((p) => p.fields.report);
  const reportCompany = (() => { const names = Array.from(new Set(reportPeople.map((p) => p.fields.agent).filter(Boolean))); return names.length === 1 ? names[0] : ""; })();
  // entry + new expiry per person: run board = the run day / run + visa days (+30);
  // extension board = the arrival stamp / admitted-until + extension days
  function expiryOf(p: Person): { entry: Date | null; expiry: Date | null; kind: "run" | "run30" | "ext"; tag: string } {
    const f = p.fields;
    if (isRun) {
      const kind = f.run === "RUN30" ? "run30" : "run";
      return { entry: parseDdmmyyyy(meta.date), expiry: runExpiry(meta.date, f.visaType, f.run || "RUN", f.newUntil), kind, tag: kind === "run30" ? "วีซ่ารัน + ต่อ 30 วัน · 过境+延期30天" : "" };
    }
    return { entry: parseDdmmyyyy(f.arrivalDate), expiry: extensionExpiry(f.arrivalDate, f.admittedUntil, f.visaType, meta.extensionDays, f.newUntil), kind: "ext", tag: `ต่อวีซ่า ${meta.extensionDays || 30} วัน · 延期${meta.extensionDays || 30}天` };
  }
  const reportRows: ReportRow[] = reportPeople.map((p) => {
    const e = expiryOf(p);
    return { id: p.id, name: [p.fields.lastName, p.fields.firstName].filter(Boolean).join(" "), cn: p.fields.chineseName, passportNo: p.fields.passportNo, entry: e.entry, expiry: e.expiry, tag: e.tag, person: p };
  });
  const reportDay = parseDdmmyyyy(meta.date);
  const reportHeader = {
    title: "สรุปวันหมดอายุวีซ่า · 签证到期日汇总",
    subtitle: `${reportCompany ? `${reportCompany} · ` : ""}${isRun ? `วีซ่ารัน ${reportDay ? thDate(reportDay) : meta.date} · 过境日期 ${reportDay ? zhDate(reportDay) : meta.date}` : `ต่อวีซ่า ${meta.extensionDays || 30} วัน ${OFFICES[meta.office].label} ${reportDay ? thDate(reportDay) : meta.date} · 延期${meta.extensionDays || 30}天 ${reportDay ? zhDate(reportDay) : meta.date}`}`,
    badge: isRun ? "VISA RUN REPORT" : "VISA EXTENSION REPORT",
    count: `👥 ${reportPeople.length} คน · ${reportPeople.length} 人`,
    note: isRun ? "วันหมดอายุคำนวณจากตราเข้าเมืองวันนี้ กรุณาตรวจกับตราในพาสปอร์ตอีกครั้ง · 到期日按今日入境章计算，请再次核对护照上的印章" : "วันหมดอายุคำนวณจากตราต่อวีซ่าวันนี้ กรุณาตรวจกับตราในพาสปอร์ตอีกครั้ง · 到期日按今日延期章计算，请再次核对护照上的印章",
  };
  // write the ticked people into the expiry ledger (one record per passport, latest wins) — feeds /expiry
  const [ledgerState, setLedgerState] = useState("");
  async function saveToLedger(list: Person[]) {
    const records = list.map((p) => { const e = expiryOf(p); return {
      passportNo: p.fields.passportNo, name: [p.fields.lastName, p.fields.firstName].filter(Boolean).join(" "), cn: p.fields.chineseName, agent: p.fields.agent, phone: p.fields.phone,
      kind: e.kind, office: meta.office, jobDate: meta.date, entry: e.entry ? fmtDdmmyyyy(e.entry) : "", expiry: e.expiry ? fmtDdmmyyyy(e.expiry) : "",
    }; }).filter((r) => r.passportNo && r.expiry);
    if (!records.length) { setLedgerState("ไม่มีคนที่มีเลขพาสปอร์ต + วันหมดอายุ"); return; }
    setLedgerState("กำลังบันทึกทะเบียน…");
    try {
      const r = await fetch("/api/expiry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ records }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({ error: `HTTP ${r.status}` }))).error);
      setLedgerState(`บันทึกทะเบียนหมดอายุ ${records.length} คน ${new Date().toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}`);
    } catch (e) { setLedgerState("บันทึกทะเบียนไม่สำเร็จ: " + (e instanceof Error ? e.message : String(e))); }
  }
  function tickReport(filter: (p: Person) => boolean, on: boolean) {
    for (const p of peopleRef.current) if (!p.cancelled && !p.movedTo && filter(p)) upsertPerson({ ...p, fields: { ...p.fields, report: on } });
  }
  async function makeExpiryReport(): Promise<Blob | null> {
    const el = reportRef.current;
    if (!el || !reportPeople.length) return null;
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js");
    const hti = (window as unknown as { htmlToImage: { toBlob: (el: HTMLElement, o: Record<string, unknown>) => Promise<Blob | null> } }).htmlToImage;
    return hti.toBlob(el, { pixelRatio: 2, cacheBust: false, backgroundColor: "#ffffff" });
  }
  async function downloadExpiryReport() {
    setError("");
    if (!reportPeople.length) { setError("ยังไม่ได้ติ๊ก 📅 ใส่ในสรุปหมดอายุ ให้ใครเลย"); return; }
    try {
      const blob = await makeExpiryReport();
      if (blob) downloadBlob(blob, `expiry_${meta.date.replace(/\//g, "")}_${reportCompany || "report"}.png`);
      void saveToLedger(reportPeople);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  // ---------- collect-amount image + bill ----------
  // The card is a React component rendered off-screen: set the target, let it
  // paint, capture with html-to-image. Falls back to the old passport-page
  // image if the card could not be captured.
  const collectRef = useRef<HTMLDivElement>(null);
  const [collectTarget, setCollectTarget] = useState<Person | null>(null);
  async function collectOne(p: Person, download = true): Promise<Blob | null> {
    const passport = p.files.find((x) => x.kind === "passport");
    const amount = Number(p.fields.amount) || 0;
    if (!amount) { setError(`${personFolderName(p)}: ยังไม่ใส่ยอดเงิน`); return null; }
    let blob: Blob | null = null;
    try {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js");
      const hti = (window as unknown as { htmlToImage: { toBlob: (el: HTMLElement, o: Record<string, unknown>) => Promise<Blob | null> } }).htmlToImage;
      setCollectTarget(p);
      await new Promise((r) => setTimeout(r, 450));
      if (collectRef.current) blob = await hti.toBlob(collectRef.current, { pixelRatio: 2, cacheBust: false, backgroundColor: "#ffffff" });
    } catch { blob = null; }
    finally { setCollectTarget(null); }
    if (!blob) {
      if (!passport) { setError(`${personFolderName(p)}: ไม่มีรูปพาสปอร์ต`); return null; }
      blob = await buildCollectImage(passport.blob, amount, p.fields.agent ? p.fields.agent : "");
    }
    patchPerson(p.id, (x) => ({ ...x, collectImage: blob as Blob }));
    if (download) downloadBlob(blob, `เก็บ-${amount}-${personFolderName(p)}.png`);
    return blob;
  }
  async function collectAll() {
    const todo = active.filter((p) => p.fields.pay === "collect" && Number(p.fields.amount) > 0 && p.files.some((x) => x.kind === "passport"));
    if (!todo.length) { setError("ยังไม่มีคนที่ต้องเก็บเงิน + มียอด + มีพาสปอร์ต"); return; }
    setError("");
    for (const p of todo) await collectOne(p, true);
    setStatus(`รูปเรียกเก็บ ${todo.length} รูป`);
  }
  function openBill(list: Person[]) {
    const amount = list.length === 1 ? Number(list[0].fields.amount) || 0 : list.reduce((s, p) => s + (Number(p.fields.amount) || 0), 0);
    window.open(billUrl(list, amount), "_blank");
    // register the bill so it can be re-issued later (kept 1 year on the server)
    void fetch("/api/bills", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      date: meta.date, office: meta.office, amount,
      customers: list.map((p) => ({ en: [p.fields.lastName, p.fields.firstName].filter(Boolean).join(" "), cn: p.fields.chineseName, pp: p.fields.passportNo })),
    }) }).catch(() => {});
  }

  // ---------- agent settlement ----------
  const [showAgents, setShowAgents] = useState(false);
  const num = (v: string | undefined) => Number(v) || 0;
  const agentGroups = (() => {
    const m = new Map<string, Person[]>();
    for (const p of active) { const k = p.fields.agent || "(ไม่ระบุ)"; m.set(k, [...(m.get(k) ?? []), p]); }
    return [...m.entries()];
  })();
  async function agentExcel() {
    try { downloadBlob(await buildAgentExcel(active, meta.date, OFFICES[meta.office].label), `agents_${meta.date.replace(/\//g, "")}_${meta.jobType}.xlsx`); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  // ---------- bill history ----------
  type BillRow = { id: string; createdAt: string; date: string; office: string; amount: number; customers: { en: string; cn: string; pp: string }[] };
  const [showBills, setShowBills] = useState(false);
  const [billQuery, setBillQuery] = useState("");
  const [bills, setBills] = useState<BillRow[] | null>(null);
  async function searchBills(q: string) {
    setBills(null);
    const r = await fetch(`/api/bills?q=${encodeURIComponent(q)}`, { cache: "no-store" });
    setBills(r.ok ? ((await r.json()) as { bills: BillRow[] }).bills : []);
  }
  function reopenBill(b: BillRow) {
    const fake = b.customers.map((c, i) => ({ id: String(i), order: i + 1, createdAt: 0, files: [], fields: { ...EMPTY_FIELDS, firstName: c.en.split(" ").slice(0, -1).join(" ") || c.en, lastName: c.en.split(" ").slice(-1)[0] || "", chineseName: c.cn, passportNo: c.pp } })) as Person[];
    window.open(billUrl(fake, b.amount), "_blank");
  }

  async function excelTm30() {
    // on the visa-run board only people going on to the 30-day extension need a TM.30
    const groups = groupsFor((p) => !!p.fields.firstName && !!p.fields.passportNo && (!isRun || p.fields.run === "RUN30"));
    if (!groups.length) { setError(isRun ? "ยังไม่มีคน 'ไปต่อ 30 วัน' ที่มีชื่อและเลขพาสปอร์ต (run อย่างเดียวไม่ต้องทำ TM30)" : "ยังไม่มีคนที่มีชื่อและเลขพาสปอร์ต"); return; }
    try {
      for (const b of groups) {
        const blob = await buildTm30Excel(b.people, plusDaysDdmmyyyy(10));
        downloadBlob(blob, `TM30_${meta.date.replace(/\//g, "")}_${b.people.length}คน${tagOf(b)}.xls`);
        if (groups.length > 1) await pause(400);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function dayZip() {
    if (!people.length) return;
    setWorking(true); setStatus("กำลังสร้าง zip โฟลเดอร์…");
    try {
      const sheet = await photoSheet();
      const summary = summaryBlob ?? (await makeSummary().catch(() => null));
      const cars = isRun ? await makeCarCards().catch(() => []) : [];
      const report = await makeExpiryReport().catch(() => null);
      if (report) cars.push({ name: "expiry-report.png", blob: report });
      if (summaryAgents.length > 1) cars.push(...(await makeAgentSummaries().catch(() => [])));
      // one zip per batch of BATCH people; the day-level extras (photo sheet,
      // summary, car cards, report) ride along in the first zip only
      for (const b of selBatches) {
        if (allBatches.length > 1) setStatus(`กำลังสร้าง zip ชุด ${b.k + 1}…`);
        const extras = b.k === 0 ? { photoSheet: sheet ?? undefined, summary: summary ?? undefined, cars } : { cars: [] };
        const blob = await buildDayZip(b.people, meta, extras);
        downloadBlob(blob, `${meta.date.replace(/\//g, "")}_${meta.jobType}${tagOf(b)}.zip`);
        if (selBatches.length > 1) await pause(600);
      }
      setStatus("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  async function clearDay() {
    if (!window.confirm(`ลบข้อมูลวัน ${meta.date} ของ ${OFFICES[meta.office].label} ทั้งหมดออกจากเซิร์ฟเวอร์? (หน้างานอื่นในวันเดียวกันไม่กระทบ)`)) return;
    await clearDayRemote(meta.date);
    setPeople([]);
    setStatus("");
    listDays().then(setDays);
  }

  // ---------- file moves ----------
  function moveFile(fromId: string, fileId: string, toId: string) {
    const from = peopleRef.current.find((p) => p.id === fromId);
    const to = peopleRef.current.find((p) => p.id === toId);
    if (!from || !to || fromId === toId) return;
    const f = from.files.find((x) => x.id === fileId);
    if (!f) return;
    upsertPerson({ ...from, files: from.files.filter((x) => x.id !== fileId) });
    upsertPerson({ ...to, files: [...to.files, f] });
  }

  // ---------- render ----------
  const collect = active.filter((p) => p.fields.pay === "collect");
  const collectSum = collect.reduce((s, p) => s + (Number(p.fields.amount) || 0), 0);
  const receivedSum = collect.reduce((s, p) => s + ((p.fields.paidHow === "cash" || p.fields.paidHow === "transfer") ? (Number(p.fields.paidAmount || p.fields.amount) || 0) : 0), 0);
  const pendingCount = collect.filter((p) => (p.fields.paidHow ?? "pending") === "pending").length;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{isRun ? "🚗 Visa Run" : "งานวันนี้"}</h1>
          <p className="text-sm text-slate-600">{isRun ? "โยนรูปลูกค้าวีซ่ารันลงทีเดียว → แยกคน อ่านข้อมูล จัดคนลงรถ ทำการ์ดรถ summary และ TM7 เฉพาะคนไปต่อ 30 วัน" : "โยนรูปจาก LINE ทั้งวันลงทีเดียว → ระบบแยกคน อ่านข้อมูล ทำฟอร์ม ทำ Excel TM30 และโฟลเดอร์ให้"}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">วันที่ยื่น</span>
            <div className="flex items-center gap-1">
              <button type="button" className={btnCls + " px-2"} title="วันก่อนหน้า" onClick={() => shiftDay(-1)}>◀</button>
              <input value={meta.date} onChange={(e) => setMeta((m) => ({ ...m, date: formatDateMask(e.target.value) }))} onBlur={(e) => commitDate(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitDate((e.target as HTMLInputElement).value); }} className={inputCls + " w-32 text-center"} placeholder="DD/MM/YYYY" />
              <button type="button" className={btnCls + " px-2"} title="วันถัดไป" onClick={() => shiftDay(1)}>▶</button>
              <button type="button" className={btnCls + " px-2"} title="เลือกจากปฏิทิน" onClick={openCalendar}>📅</button>
              <input ref={calendarRef} type="date" value={toIso(meta.date)} onChange={(e) => { const v = fromIso(e.target.value); if (v) commitDate(v); }} className="sr-only" tabIndex={-1} aria-hidden />
            </div>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">ชื่อโฟลเดอร์</span>
            <input value={meta.jobType} onChange={(e) => updateMeta({ jobType: e.target.value.toUpperCase() })} className={inputCls + " w-24"} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">หน้างาน / ด่าน</span>
            <select value={meta.office} onChange={(e) => changeOffice(e.target.value as OfficeId)} className={inputCls + " w-44 font-semibold"} style={{ borderColor: OFFICES[meta.office].summaryAccent, color: OFFICES[meta.office].summaryAccent }}>
              {OFFICE_IDS.map((id) => <option key={id} value={id}>{OFFICES[id].label}</option>)}
            </select>
            <span className="mt-0.5 block text-[10px] text-slate-400">{OFFICES[meta.office].pages}</span>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">วันที่ขอต่อ</span>
            <input value={meta.extensionDays} onChange={(e) => updateMeta({ extensionDays: e.target.value })} className={inputCls + " w-16"} />
          </label>
          {isRun && (
            <>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">รอบ</span>
                <select value={meta.slot || "morning"} onChange={(e) => updateMeta({ slot: e.target.value })} className={inputCls + " w-24"}>
                  {RUN_SLOTS.map((s) => <option key={s.id} value={s.id}>{s.th}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">เที่ยวบิน</span>
                <input value={meta.flight || ""} onChange={(e) => updateMeta({ flight: e.target.value.toUpperCase() })} className={inputCls + " w-24"} placeholder="DD102" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">เครื่องลง</span>
                <input value={meta.landTime || ""} onChange={(e) => updateMeta({ landTime: formatTimeMask(e.target.value) })} className={inputCls + " w-20 text-center"} placeholder="10:00" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">กลับถึงสนามบินก่อน</span>
                <input value={meta.returnBy || ""} onChange={(e) => updateMeta({ returnBy: formatTimeMask(e.target.value) })} className={inputCls + " w-20 text-center"} placeholder="18:45" />
              </label>
            </>
          )}
        </div>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">วันที่มีข้อมูลในสัปดาห์นี้:</span>
        {days.length === 0 && <span className="text-slate-400">— ยังไม่มี —</span>}
        {days.map((d) => {
          const label = `${d.date.slice(0, 2)}/${d.date.slice(2, 4)}/${d.date.slice(4)}`;
          const active = label === meta.date;
          return <button key={d.date} type="button" onClick={() => commitDate(label)} className={`rounded-full border px-2.5 py-0.5 ${active ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>{label}</button>;
        })}
        <span className={`ml-auto ${saveState.startsWith("บันทึกไม่") ? "text-red-600" : "text-slate-400"}`}>{saveState}</span>
        <a href="/api/day/debug" target="_blank" className="text-[10px] text-slate-300 hover:text-slate-500" title="ทดสอบที่เก็บไฟล์">ตรวจที่เก็บ</a>
      </div>

      <DropZone onFiles={handleFiles} disabled={working || !loaded} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-700">
          <span className="font-semibold">{active.length}</span> คน{people.some((p) => p.cancelled) && <span className="text-slate-400"> · ไม่มา {people.filter((p) => p.cancelled).length}</span>}{people.some((p) => p.movedTo) && <span className="text-slate-400"> · เลื่อนวัน {people.filter((p) => p.movedTo).length}</span>}
          {collect.length > 0 && <span className="ml-3 rounded bg-yellow-100 px-2 py-0.5 text-yellow-900">แผนเก็บ {collect.length} คน {collectSum.toLocaleString()} บาท</span>}
          {collect.length > 0 && <span className="ml-2 rounded bg-emerald-100 px-2 py-0.5 text-emerald-900">รับแล้ว {receivedSum.toLocaleString()} บาท</span>}
          {pendingCount > 0 && <span className="ml-2 rounded bg-red-100 px-2 py-0.5 text-red-900">ค้าง {pendingCount} คน</span>}
          {active.length > 0 && <span className="ml-2 rounded bg-emerald-50 px-2 py-0.5 text-emerald-900">✅ มาแล้ว {active.filter((p) => p.arrived).length}/{active.length}</span>}
          {isRun && active.length > 0 && <span className="ml-2 rounded bg-indigo-50 px-2 py-0.5 text-indigo-900">🚗 {carsInUse.length} คัน{unassigned.length ? ` · ยังไม่ลงรถ ${unassigned.length}` : ""} · ไปต่อ 30 วัน {active.filter((p) => p.fields.run === "RUN30").length}</span>}
          {status && <span className="ml-3 text-slate-500">{status}</span>}
        </div>
        {allBatches.length > 1 && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
            <span className="font-semibold text-amber-900">📦 ทำเอกสารชุด:</span>
            {allBatches.map((b) => (
              <button key={b.k} type="button" onClick={() => setBatchSel(b.k)} className={`rounded-full px-3 py-1 text-xs font-semibold ${batchSel === b.k ? "bg-amber-600 text-white" : "bg-white text-amber-900 ring-1 ring-amber-300"}`}>
                ชุด {b.k + 1} · คน {String(b.from).padStart(2, "0")}–{String(b.to).padStart(2, "0")}
              </button>
            ))}
            <button type="button" onClick={() => setBatchSel("all")} className={`rounded-full px-3 py-1 text-xs font-semibold ${batchSel === "all" ? "bg-amber-600 text-white" : "bg-white text-amber-900 ring-1 ring-amber-300"}`}>ทุกชุด</button>
            <span className="text-xs text-amber-800">ใช้กับ TM7 ทุกคน · Excel TM30 · แผ่น A4 รูป · zip (ชุดละไม่เกิน {BATCH} คน)</span>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => addEmptyPerson()} className={btnCls}>+ เพิ่มคนว่าง</button>
          <button onClick={excelTm30} disabled={working || !people.length} className={btnCls} title={isRun ? "เฉพาะคนที่ไปต่อ 30 วัน" : undefined}>⬇ Excel TM30{isRun ? ` (ต่อ 30 วัน ${active.filter((p) => p.fields.run === "RUN30").length})` : ""}</button>
          {OFFICES[meta.office].generator !== "none" && <button onClick={tm7All} disabled={working || !people.length} className={btnPrimaryCls}>{isRun ? "⬇ TM7 คนไปต่อ 30 วัน (PDF เดียว)" : "⬇ TM7 ทุกคน (PDF เดียว)"}</button>}
          {isRun && <button onClick={() => downloadCarCards("customer")} disabled={working || !people.length} className={btnPrimaryCls} title="มีจุดนัดพบประตู 2 — ส่งให้ลูกค้า">🚗 การ์ดลูกค้า (ทุกคัน)</button>}
          {isRun && <button onClick={() => downloadCarCards("driver")} disabled={working || !people.length} className={btnPrimaryCls} title="ไม่มีจุดนัดพบ รูปหน้าใหญ่ — ส่งให้คนขับ">🧑‍✈️ การ์ดคนขับ (ทุกคัน)</button>}
          <button onClick={downloadExpiryReport} disabled={working || !reportPeople.length} className={btnCls} title="รูปสรุปชื่อ/พาสปอร์ต/วันเข้า/วันหมดอายุ ของคนที่ติ๊ก 📅 — ส่งกลับโรงงาน/เอเจนซี่ตอนเย็น">📅 สรุปหมดอายุ ({reportPeople.length})</button>
          <button onClick={photosAll} disabled={working || !people.length} className={btnPrimaryCls}>✦ ทำรูปพื้นขาวทุกคน</button>
          <button onClick={downloadPhotoSheet} disabled={working || !people.some((p) => p.photo)} className={btnCls}>⬇ แผ่น A4 รูป (PDF)</button>
          <button onClick={downloadSummary} disabled={working || !people.length} className={btnPrimaryCls}>⬇ Summary (PNG){summaryAgent ? ` · ${summaryAgent}` : ""}</button>
          {summaryAgents.length > 1 && <button onClick={downloadAgentSummaries} disabled={working} className={btnCls} title="ออก summary คนละรูปต่อเอเจนซี่หลัก เห็นเฉพาะลูกค้าของเขา พร้อมโน้ตเอเจนซี่ย่อย">⬇ Summary แยกเอเจนซี่ ({summaryAgents.length})</button>}
          <button onClick={collectAll} disabled={working || !people.length} className={btnCls}>฿ รูปเรียกเก็บทุกคน</button>
          <button onClick={() => openBill(active.filter((p) => p.fields.pay === "collect"))} disabled={!active.some((p) => p.fields.pay === "collect")} className={btnCls} title="บิลรวมคนที่ต้องเก็บเงิน (สูงสุด 5 คน)">🧾 บิลรวม</button>
          <button onClick={() => setShowAgents((v) => !v)} disabled={!people.length} className={btnCls} title="สรุปราคาเอเจนซี่/ต้นทุน/กำไรของวันนี้">Σ สรุปเอเจนซี่</button>
          {isRun && <button onClick={runDaySheet} disabled={working || !people.length} className={btnCls} title="รูปตารางรายคนส่งให้ด่าน — แถบสีตามคันรถ, ต่อ 30 วัน/อยู่เกิน, 🐻, เงินสดที่คนขับเก็บ">📊 ตารางส่งด่าน (PNG)</button>}
          <button onClick={() => { setShowBills((v) => !v); if (!showBills) void searchBills(""); }} className={btnCls} title="ค้นบิลย้อนหลัง">🧾 ประวัติบิล</button>
          <button onClick={() => setShowSettings((v) => !v)} className={btnCls} title="ตั้งค่ารูป">⚙</button>
          <button onClick={dayZip} disabled={working || !people.length} className={btnCls}>⬇ โฟลเดอร์วันนี้ (zip)</button>
          <button onClick={clearDay} disabled={working} className={btnDangerCls}>ล้างวัน</button>
        </div>
      </div>

      {showAgents && (
        <div className="mt-3 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <b>สรุปเอเจนซี่ วันที่ {meta.date} — {OFFICES[meta.office].label}</b>
            <button onClick={agentExcel} className={btnCls}>⬇ Excel เรียกเก็บเอเจนซี่</button>
          </div>
          <div className="mt-3 space-y-3">
            {agentGroups.map(([agent, list]) => {
              const price = list.reduce((s, p) => s + num(p.fields.agentPrice), 0);
              const cost = list.reduce((s, p) => s + num(p.fields.cost), 0);
              const received = list.reduce((s, p) => s + ((p.fields.paidHow === "cash" || p.fields.paidHow === "transfer") ? num(p.fields.paidAmount || p.fields.amount) : 0), 0);
              const invoice = Math.max(0, price - received);
              return (
                <div key={agent} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">{agent} <span className="font-normal text-slate-500">({list.length} คน)</span></span>
                    <span className="text-xs">ราคาเอเจนซี่ <b>{price.toLocaleString()}</b> − ลูกค้าจ่ายเราตรง <b>{received.toLocaleString()}</b> = <b className="rounded bg-indigo-100 px-1.5 py-0.5 text-indigo-900">เรียกเก็บเอเจนซี่ {invoice.toLocaleString()}</b> · ต้นทุน {cost.toLocaleString()} · กำไร <b className={price - cost < 0 ? "text-red-600" : "text-emerald-700"}>{(price - cost).toLocaleString()}</b></span>
                  </div>
                  <table className="mt-2 w-full text-xs">
                    <tbody>
                      {list.map((p) => (
                        <tr key={p.id} className="border-t border-slate-100">
                          <td className="py-1 w-8 text-slate-400">{String(p.order).padStart(2, "0")}</td>
                          <td>{[p.fields.lastName, p.fields.firstName].filter(Boolean).join(" ")} {p.fields.chineseName}</td>
                          <td className="text-slate-500">{({ pending: "⏳", cash: "💵 เงินสด", transfer: "📲 โอน", agent: "🏢 เอเจนซี่", none: "" } as Record<string, string>)[p.fields.paidHow ?? "none"]}</td>
                          <td className="text-right">{num(p.fields.agentPrice).toLocaleString()}</td>
                          <td className="text-right text-slate-500">−{num(p.fields.cost).toLocaleString()}</td>
                          <td className="text-slate-500">{p.fields.costNote}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500">รวมทั้งวัน: ราคาเอเจนซี่ {active.reduce((s, p) => s + num(p.fields.agentPrice), 0).toLocaleString()} · ต้นทุน {active.reduce((s, p) => s + num(p.fields.cost), 0).toLocaleString()} · กำไร {(active.reduce((s, p) => s + num(p.fields.agentPrice) - num(p.fields.cost), 0)).toLocaleString()} บาท</p>
        </div>
      )}

      {showBills && (
        <div className="mt-3 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-wrap items-center gap-2">
            <input value={billQuery} onChange={(e) => setBillQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void searchBills(billQuery); }} placeholder="ค้นชื่อ / ชื่อจีน / เลขพาสปอร์ต" className={inputCls + " w-72"} />
            <button onClick={() => void searchBills(billQuery)} className={btnCls}>ค้นหา</button>
            <span className="text-xs text-slate-500">บิลที่เคยกดออกจากหน้านี้ เก็บไว้ 1 ปี — กด "เปิดบิล" เพื่อออกใบเดิมให้ลูกค้าอีกครั้ง</span>
          </div>
          <div className="mt-3 max-h-72 overflow-auto">
            {bills === null && <p className="text-xs text-slate-400">กำลังค้นหา…</p>}
            {bills && bills.length === 0 && <p className="text-xs text-slate-400">ไม่พบ</p>}
            {bills && bills.length > 0 && (
              <table className="w-full text-xs">
                <thead><tr className="text-left text-slate-500"><th className="py-1">วันที่</th><th>หน้างาน</th><th>ลูกค้า</th><th className="text-right">บาท</th><th></th></tr></thead>
                <tbody>
                  {bills.map((b) => (
                    <tr key={b.id} className="border-t border-slate-100">
                      <td className="py-1 whitespace-nowrap">{b.date}</td>
                      <td>{OFFICES[b.office as OfficeId]?.short ?? b.office}</td>
                      <td>{b.customers.map((c) => `${c.en}${c.cn ? ` ${c.cn}` : ""} (${c.pp})`).join(", ")}</td>
                      <td className="text-right">{b.amount.toLocaleString()}</td>
                      <td className="text-right"><button onClick={() => reopenBill(b)} className={btnCls + " px-2 py-0.5"}>เปิดบิล</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {showSettings && (
        <div className="mt-3 grid gap-3 rounded-2xl bg-white p-4 text-sm shadow-sm ring-1 ring-slate-200 lg:grid-cols-3">
          <div className="flex gap-3 lg:col-span-3">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-500">AI สร้างรูป</span>
              <select value={photoSettings.provider} onChange={(e) => updatePhotoSettings({ provider: e.target.value as PhotoSettings["provider"] })} className={inputCls}>
                <option value="openai">OpenAI</option><option value="gemini">Gemini (gemini-2.5-flash-image)</option>
              </select>
            </label>
            {photoSettings.provider === "openai" && (
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">โมเดล</span>
                <select value={photoSettings.model} onChange={(e) => updatePhotoSettings({ model: e.target.value })} className={inputCls}>
                  <option>gpt-image-1.5</option><option>gpt-image-2</option><option>chatgpt-image-latest</option><option>gpt-image-1-mini</option>
                </select>
              </label>
            )}
            <p className="self-end text-xs text-slate-500">ต้องมี OPENAI_API_KEY ใน Vercel (Preview + Production)</p>
          </div>
          <label className="block"><span className="mb-1 block text-xs text-slate-500">Prompt กรณีมีเซลฟี่</span>
            <textarea rows={5} value={photoSettings.promptSelfie} onChange={(e) => updatePhotoSettings({ promptSelfie: e.target.value })} className={inputCls} /></label>
          <label className="block"><span className="mb-1 block text-xs text-slate-500">Prompt กรณีใช้รูปพาสปอร์ต — {"{เสื้อผ้า}"} จะถูกสุ่มแทน</span>
            <textarea rows={5} value={photoSettings.promptPassport} onChange={(e) => updatePhotoSettings({ promptPassport: e.target.value })} className={inputCls} /></label>
          <label className="block"><span className="mb-1 block text-xs text-slate-500">วันหยุดราชการ (DD/MM/YYYY บรรทัดละวัน) — ใช้คำนวณค่าปรับ overstay: หมดวันหยุดแล้วมาต่อวันทำการถัดไปไม่เสียค่าปรับ</span>
            <textarea rows={5} value={holidays.join("\n")} onChange={(e) => { const list = e.target.value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean); setHolidays(list); saveHolidays(list); }} className={inputCls} /></label>
          <label className="block"><span className="mb-1 block text-xs text-slate-500">รายการเสื้อผ้า (บรรทัดละแบบ)</span>
            <textarea rows={5} value={photoSettings.clothes} onChange={(e) => updatePhotoSettings({ clothes: e.target.value })} className={inputCls} /></label>
        </div>
      )}

      {error && <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {/* off-screen visa-run day table for the checkpoint partner, mounted only while being captured */}
      {runSheetRows && (
        <div style={{ position: "absolute", left: -20000, top: 0 }}>
          <RunDaySheet ref={runSheetRef} rows={runSheetRows} date={meta.date} />
        </div>
      )}
      {/* off-screen "amount to collect" card, mounted only while being captured */}
      {collectTarget && (
        <div style={{ position: "absolute", left: -20000, top: 0 }}>
          <CollectCard ref={collectRef} person={collectTarget} meta={meta} run={isRun} />
        </div>
      )}

      <div className="mt-6 space-y-4">
        {loaded && people.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">ยังไม่มีลูกค้าวันนี้ — ลากรูปลงด้านบน</p>
        )}
        {/* newest first on screen: the person just dropped in sits right under
            the drop zone for OCR checking; numbering (order), summary, Excel and
            PDFs keep the original 01, 02, … sequence */}
        {[...people].reverse().map((p) => (
          <PersonCard
            key={p.id}
            person={p}
            people={people}
            meta={meta}
            onChange={(next) => upsertPerson(next)}
            onRemove={() => removePerson(p.id)}
            onTm7={() => tm7One(p)}
            onPhoto={() => photoOne(p)}
            onCollect={() => collectOne(p)}
            onBill={() => openBill([p])}
            onCrop={(crop, photo) => updateCrop(p.id, crop, photo)}
            onUseAsPhoto={(fileId) => usePhotoAsIs(p, fileId)}
            onMoveDay={() => moveDay(p)}
            onMoveOffice={(o) => moveOffice(p, o)}
            onToggleArrived={() => toggleArrived(p)}
            onOverstayCalc={() => openOverstayCalc(p)}
            onToggleCancelled={() => toggleCancelled(p)}
            clothes={clothesList()}
            onMoveFile={(fileId, toId) => moveFile(p.id, fileId, toId)}
            holidays={holidays}
            busy={working}
            mode={mode}
            needsTm7={needsTm7(p)}
          />
        ))}
      </div>

      {isRun && (
        <div className="mt-8">
          <div className="mb-2 flex items-center gap-3">
            <h2 className="text-sm font-semibold text-slate-700">การ์ดรถ (1 รูปต่อคัน)</h2>
            {(["customer", "driver"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setCarView(v)} className={`rounded-full px-3 py-0.5 text-xs ${carView === v ? "bg-indigo-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>{v === "customer" ? "🚗 แบบลูกค้า (มีจุดนัดพบ)" : "🧑‍✈️ แบบคนขับ"}</button>
            ))}
          </div>
          {carsInUse.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">เลือก "รถ" ในการ์ดของแต่ละคน แล้วการ์ดรถจะโผล่ตรงนี้</p>}
          <div className="flex flex-wrap gap-4">
            {carsInUse.map((c) => {
              const riders = active.filter((p) => p.fields.car === c.id);
              return (
                <div key={c.id}>
                  {riders.length > c.seats && <p className="mb-1 text-xs font-semibold text-red-600">⚠ {c.name} นั่งได้ {c.seats} คน แต่จัดไว้ {riders.length} คน</p>}
                  {/* both variants stay mounted so either can be exported; the one not being viewed sits off-screen */}
                  <div className="overflow-auto rounded-2xl ring-1 ring-slate-200" style={carView === "customer" ? undefined : { position: "absolute", left: -20000, top: 0 }}>
                    <CarCard ref={(el) => { carRefs.current[c.id] = el; }} car={c} people={riders} meta={meta} variant="customer" />
                  </div>
                  <div className="overflow-auto rounded-2xl ring-1 ring-slate-200" style={carView === "driver" ? undefined : { position: "absolute", left: -20000, top: 0 }}>
                    <CarCard ref={(el) => { driverRefs.current[c.id] = el; }} car={c} people={riders} meta={meta} variant="driver" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(
        <div className="mt-8">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-700">📅 สรุปวันหมดอายุ (ส่งกลับโรงงาน/เอเจนซี่ตอนเย็น)</h2>
            <span className="text-xs text-slate-500">ติ๊ก 📅 ในการ์ดคน หรือ:</span>
            {Array.from(new Set(active.map((p) => p.fields.agent).filter(Boolean))).map((a) => (
              <button key={a} type="button" onClick={() => tickReport((p) => p.fields.agent === a, true)} className={btnCls + " px-2 py-0.5 text-xs"}>ติ๊กทุกคนของ {a}</button>
            ))}
            <button type="button" onClick={() => tickReport(() => true, true)} className={btnCls + " px-2 py-0.5 text-xs"}>ติ๊กทุกคน</button>
            <button type="button" onClick={() => tickReport(() => true, false)} className={btnCls + " px-2 py-0.5 text-xs"}>ล้าง</button>
            <span className="mx-1 text-slate-300">|</span>
            <button type="button" onClick={() => saveToLedger(active)} disabled={!active.length} className={btnCls + " px-2 py-0.5 text-xs"} title="เก็บ ชื่อ/พาส/เอเจนซี่/วันหมดอายุ ของทุกคนวันนี้ไว้ในทะเบียน (หน้า ใกล้หมดอายุ) — กด export สรุปก็บันทึกให้อัตโนมัติ">💾 บันทึกทะเบียนหมดอายุทุกคน</button>
            <a href="/expiry" className="text-xs text-indigo-700 hover:underline">⏰ ดูหน้าใกล้หมดอายุ</a>
            {ledgerState && <span className={`text-xs ${ledgerState.startsWith("บันทึกทะเบียนไม่") ? "text-red-600" : "text-slate-500"}`}>{ledgerState}</span>}
          </div>
          <div className="overflow-auto rounded-2xl ring-1 ring-slate-200">
            <ExpiryReport ref={reportRef} rows={reportRows} header={reportHeader} today={reportDay ?? new Date()} />
          </div>
        </div>
      )}

      {/* one-page summary (rendered off-screen, exported with html-to-image) */}
      <div className="mt-8">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-700">ตัวอย่าง Summary</h2>
          <span className="text-xs text-slate-500">แสดง:</span>
          <button type="button" onClick={() => setSummaryAgent("")} className={`rounded-full px-3 py-0.5 text-xs ${!summaryAgent ? "bg-indigo-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>ทุกคน</button>
          {summaryAgents.map((a) => (
            <button key={a} type="button" onClick={() => setSummaryAgent(a)} className={`rounded-full px-3 py-0.5 text-xs ${summaryAgent === a ? "bg-indigo-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>🏢 {a} ({active.filter((p) => p.fields.agent === a).length})</button>
          ))}
          {summaryAgent && <span className="text-xs text-slate-500">— รูปนี้ส่งให้ {summaryAgent} โดยตรง โชว์โน้ตเอเจนซี่ย่อยของเขา</span>}
        </div>
        <div className="overflow-auto rounded-2xl ring-1 ring-slate-200">
          <SummarySheet ref={summaryRef} people={summaryAgent ? people.filter((p) => p.fields.agent === summaryAgent) : people} meta={meta} mode={mode} agentFilter={summaryAgent} />
        </div>
      </div>
    </div>
  );
}

// =============================================================
// Person card
// =============================================================

const KIND_LABEL: Record<DocType, string> = { passport: "พาสปอร์ต", stamp: "ตราเข้าเมือง", selfie: "เซลฟี่", tm30: "TM30", other: "อื่น ๆ" };

function PersonCard({
  person: p, people, meta, onChange, onRemove, onTm7, onPhoto, onCollect, onBill, onCrop, onUseAsPhoto, onMoveDay, onMoveOffice, onToggleArrived, onOverstayCalc, onToggleCancelled, clothes, onMoveFile, holidays, busy, mode, needsTm7,
}: {
  person: Person;
  people: Person[];
  meta: DayMeta;
  onChange: (p: Person) => void;
  onRemove: () => void;
  onTm7: () => void;
  onPhoto: () => void;
  onCollect: () => void;
  onBill: () => void;
  onCrop: (crop: Crop, photo: Blob) => void;
  onUseAsPhoto: (fileId: string) => void;
  onMoveDay: () => void;
  onMoveOffice: (office: OfficeId) => void;
  onToggleArrived: () => void;
  onOverstayCalc: () => void;
  onToggleCancelled: () => void;
  clothes: string[];
  onMoveFile: (fileId: string, toPersonId: string) => void;
  holidays: string[];
  busy: boolean;
  mode: BoardMode;
  needsTm7: boolean;
}) {
  const f = p.fields;
  const isRun = mode === "run";
  const car = carById(f.car);
  function set<K extends keyof PersonFields>(key: K, value: PersonFields[K]) {
    onChange({ ...p, fields: { ...p.fields, [key]: value } });
  }
  function setFileKind(fileId: string, kind: DocType) {
    onChange({ ...p, files: p.files.map((x) => (x.id === fileId ? { ...x, kind } : x)) });
  }
  function removeFile(fileId: string) {
    onChange({ ...p, files: p.files.filter((x) => x.id !== fileId) });
  }

  // overstay: appointment date after "admitted until"
  const ov = overstayInfo(f.arrivalDate, f.admittedUntil, f.visaType, meta.date, holidays, !isRun);
  const overstayDays = ov?.days ?? 0;
  const fine = ov?.fine ?? 0;
  const missing: string[] = [];
  if (!f.firstName || !f.lastName) missing.push("ชื่อ");
  if (!f.passportNo) missing.push("เลขพาสปอร์ต");
  if (!f.arrivalDate) missing.push("วันเข้าเมือง");
  if (!f.houseNo && !f.province && needsTm7) missing.push("ที่อยู่ (TM30)");
  if (isRun && !f.car) missing.push("รถ");
  const hasSelfie = p.files.some((x) => x.kind === "selfie");

  return (
    <section className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ${p.cancelled || p.movedTo ? "opacity-50 ring-slate-200 grayscale" : fine ? "ring-red-300" : "ring-slate-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-slate-900 px-2.5 py-1 text-sm font-bold text-white">{String(p.order).padStart(2, "0")}</span>
          <div>
            <div className="text-base font-semibold text-slate-900">
              {[f.lastName, f.firstName].filter(Boolean).join(" ") || <span className="text-slate-400">ยังไม่มีชื่อ</span>}
              {f.chineseName && <span className="ml-2 text-slate-600">{f.chineseName}</span>}
              {isRun && car && <span className="ml-2 rounded px-2 py-0.5 text-xs font-semibold text-white" style={{ background: car.accent }}>🚗 {car.id} {car.plate}</span>}
              {isRun && f.run === "RUN30" && <span className="ml-2 rounded bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800">🐰 +30 วัน</span>}
              {isRun && f.cambodia && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">🐻 กัมพูชา</span>}
              {p.cancelled && <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">❌ ไม่มา / ยกเลิก</span>}
              {p.movedTo && <span className="ml-2 rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold text-slate-700">➡️ เลื่อนไป {p.movedTo}</span>}
            </div>
            <div className="text-xs text-slate-500">
              {f.passportNo || "—"} · {f.nationality || "—"}
              {p.tm7Pdf && <span className="ml-2 rounded bg-emerald-100 px-1.5 text-emerald-800">TM7 แล้ว</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onToggleArrived} className={p.arrived ? "rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white" : btnCls} title="ลูกค้ามาถึงหน้างานแล้ว (ขึ้นเครื่องหมายถูกเขียวใน summary)">{p.arrived ? "✅ มาแล้ว" : "☐ มาแล้ว?"}</button>
          {needsTm7 && <button onClick={onTm7} disabled={busy} className={btnCls}>TM7 PDF</button>}
          <button onClick={onPhoto} disabled={busy} className={btnCls}>{p.aiPhoto ? "ทำรูปใหม่" : "✦ ทำรูปพื้นขาว"}</button>
          {f.pay === "collect" && <button onClick={onCollect} disabled={busy} className={btnCls} title="รูปพาสปอร์ตพร้อมยอดที่ต้องเก็บ">฿ รูปเรียกเก็บ</button>}
          <button onClick={onBill} className={btnCls} title="เปิดโปรแกรมบิล ABC พร้อมชื่อ/พาสปอร์ต/ยอด">🧾 ออกบิล</button>
          <button onClick={onOverstayCalc} className={btnCls} title="เปิดหน้าคำนวณวันหมดอายุวีซ่า & Overstay พร้อมข้อมูลคนนี้ เพื่อทำรูปแจ้งเตือนส่งลูกค้า">🗓️ แจ้งวันหมดอายุ</button>
          <button type="button" onClick={() => set("report", !f.report)} title="ใส่คนนี้ในรูปสรุปวันหมดอายุ (ส่งกลับโรงงาน/เอเจนซี่ตอนเย็น)" className={f.report ? "rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white" : btnCls}>📅 {f.report ? "อยู่ในสรุปหมดอายุ" : "ใส่สรุปหมดอายุ"}</button>
          <button onClick={onMoveDay} disabled={busy} className={btnCls} title="ย้ายคนนี้พร้อมไฟล์ไปวันอื่น">📅 ย้ายวัน</button>
          <select value="" disabled={busy} onChange={(e) => { const o = e.target.value; if (isOfficeId(o)) onMoveOffice(o); }} className={btnCls} title="ย้ายคนนี้พร้อมไฟล์ไปหน้างานอื่นในวันเดียวกัน">
            <option value="">🏢 ย้ายหน้างาน…</option>
            {OFFICE_IDS.filter((id) => id !== meta.office).map((id) => <option key={id} value={id}>{OFFICES[id].label}</option>)}
          </select>
          <button onClick={onToggleCancelled} className={btnCls} title="ลูกค้าไม่มา: คงไว้เป็นประวัติ แต่ไม่นับยอด ไม่ออกฟอร์ม">{p.cancelled ? "↩ กลับมา" : "🚫 ไม่มา"}</button>
          <button onClick={() => { if (window.confirm("ลบคนนี้?")) onRemove(); }} className={btnDangerCls}>ลบ</button>
        </div>
      </div>

      {(fine > 0 || missing.length > 0 || !hasSelfie || (ov?.graceUntil && ov.days === 0 && (ov.lateDays ?? 0) > 0)) && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {fine > 0 && (
            <span className="rounded-lg border border-red-300 bg-red-50 px-2.5 py-1 font-semibold text-red-800">
              ⚠ OVERSTAY {overstayDays} วัน — ค่าปรับ {fine.toLocaleString()} บาท (อยู่ได้ถึง {ov?.until}{ov?.source === "visa" ? " คำนวณจากประเภทวีซ่า" : " ตามตราน้ำเงิน"}) แจ้งลูกค้าและเก็บเพิ่ม
            </span>
          )}
          {ov?.graceUntil && ov.days === 0 && (ov.lateDays ?? 0) > 0 && (
            <span className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-emerald-800">วีซ่าหมด {ov.until} (วันหยุด) ยื่นภายใน {ov.graceUntil} ไม่เสียค่าปรับ</span>
          )}
          {missing.length > 0 && <span className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-amber-800">ขาด: {missing.join(", ")}</span>}
          {!hasSelfie && <span className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-slate-600">ไม่มีเซลฟี่ → ใช้รูปจากพาสปอร์ต</span>}
        </div>
      )}

      {/* visa run: type / car / flight */}
      {isRun && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-indigo-50 p-2 ring-1 ring-indigo-200">
          <span className="text-xs font-semibold text-indigo-900">วีซ่ารัน:</span>
          {([["RUN", "🛂 รันปกติ"], ["RUN30", "🐰 ไปต่อ 30 วัน"]] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => set("run", k)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${(f.run || "RUN") === k ? "bg-indigo-600 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"}`}>{label}</button>
          ))}
          <span className="ml-2 text-xs font-semibold text-indigo-900">รถ:</span>
          {CARS.map((c) => {
            const n = people.filter((x) => !x.cancelled && !x.movedTo && x.fields.car === c.id).length;
            const on = f.car === c.id;
            return (
              <button key={c.id} type="button" onClick={() => set("car", on ? "" : c.id)} title={`${c.name} ${c.plate} · ${n}/${c.seats}`}
                className={`rounded-lg px-2.5 py-1.5 text-sm font-semibold ${on ? "text-white" : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"}`} style={on ? { background: c.accent } : undefined}>
                🚗{c.id} {c.plate} <span className={on ? "opacity-80" : "text-slate-400"}>{n}/{c.seats}</span>
              </button>
            );
          })}
          <button type="button" onClick={() => set("cambodia", !f.cambodia)} title="พาสปอร์ตมีประวัติเข้าออกกัมพูชา → ติด 🐻 ที่รูปในการ์ดคนขับ"
            className={`ml-2 rounded-lg px-2.5 py-1.5 text-sm font-semibold ${f.cambodia ? "bg-amber-700 text-white" : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"}`}>🐻 {f.cambodia ? "มีประวัติกัมพูชา" : "กัมพูชา?"}</button>
          <label className="ml-2 flex items-center gap-1 text-xs text-slate-700">✈ ไฟลท์ต่างจากวัน
            <input value={f.flight ?? ""} onChange={(e) => set("flight", e.target.value.toUpperCase())} className={inputCls + " w-20"} placeholder={meta.flight || "DD102"} />
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-700">ลง
            <input value={f.landTime ?? ""} onChange={(e) => set("landTime", formatTimeMask(e.target.value))} className={inputCls + " w-16 text-center"} placeholder={meta.landTime || "10:00"} />
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-700">กลับก่อน
            <input value={f.returnBy ?? ""} onChange={(e) => set("returnBy", formatTimeMask(e.target.value))} className={inputCls + " w-16 text-center"} placeholder={meta.returnBy || "18:45"} />
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-700" title="วันหมดอายุหลังรัน คำนวณจากวันนี้ + วันของวีซ่า (+30 ถ้าไปต่อ) — ใส่ทับได้ถ้าตราไม่ตรง">หมดอายุใหม่
            <DateIn value={f.newUntil ?? ""} onChange={(v) => set("newUntil", v)} />
            {!f.newUntil && (() => { const d = runExpiry(meta.date, f.visaType, f.run || "RUN"); return d ? <span className="text-slate-500">({fmtDdmmyyyy(d)})</span> : null; })()}
          </label>
        </div>
      )}

      {/* counter: what actually happened */}
      {f.pay === "collect" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 p-2 ring-1 ring-amber-200">
          <span className="text-xs font-semibold text-amber-900">หน้างาน: แผนเก็บ {Number(f.amount || 0).toLocaleString()} บาท →</span>
          {([
            ["cash", "💵 เงินสด", "bg-emerald-600 text-white"],
            ["transfer", "📲 โอน", "bg-sky-600 text-white"],
            ["agent", "🏢 จ่ายที่เอเจนซี่", "bg-indigo-600 text-white"],
            ["pending", "⏳ ยังไม่จ่าย", "bg-amber-500 text-white"],
          ] as const).map(([k, label, active]) => (
            <button key={k} type="button" onClick={() => onChange({ ...p, fields: { ...p.fields, paidHow: k, paidAmount: k === "cash" || k === "transfer" ? (p.fields.paidAmount || p.fields.amount) : "" } })}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${(f.paidHow ?? "pending") === k ? active : "bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"}`}>{label}</button>
          ))}
          {(f.paidHow === "cash" || f.paidHow === "transfer") && (
            <label className="ml-1 flex items-center gap-1 text-xs text-slate-700">รับจริง
              <input value={f.paidAmount ?? ""} onChange={(e) => set("paidAmount", e.target.value.replace(/[^\d]/g, ""))} className={inputCls + " w-24"} placeholder={f.amount} />
            </label>
          )}
        </div>
      )}

      {/* files */}
      <div className="mt-3 flex flex-wrap gap-2">
        {p.files.map((d) => (
          <div key={d.id} className={`w-28 rounded-lg border p-1.5 text-[11px] ${d.status === "error" ? "border-red-300 bg-red-50" : "border-slate-200"}`}>
            <Thumb doc={d} />
            <select value={d.kind} onChange={(e) => setFileKind(d.id, e.target.value as DocType)} className="mt-1 w-full rounded border border-slate-200 px-1 py-0.5">
              {(Object.keys(KIND_LABEL) as DocType[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
            <div className="mt-1 flex gap-1">
              <select value="" onChange={(e) => { if (e.target.value) onMoveFile(d.id, e.target.value); }} className="w-full rounded border border-slate-200 px-1 py-0.5" title="ย้ายไปคนอื่น">
                <option value="">ย้าย…</option>
                {people.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{String(x.order).padStart(2, "0")} {x.fields.lastName}</option>)}
              </select>
              <button onClick={() => removeFile(d.id)} className="rounded border border-slate-200 px-1.5 text-slate-500 hover:bg-slate-50">✕</button>
            </div>
            {d.mime !== "application/pdf" && d.kind !== "passport" && d.kind !== "stamp" && d.kind !== "tm30" && (
              <button onClick={() => onUseAsPhoto(d.id)} className="mt-1 w-full rounded border border-emerald-300 bg-emerald-50 px-1 py-0.5 text-[10px] text-emerald-800 hover:bg-emerald-100" title="ใช้รูปนี้เป็นรูปติดฟอร์มเลย ไม่ต้องให้ AI ทำใหม่ (ปรับตำแหน่ง/ซูมได้)">ใช้รูปนี้เลย</button>
            )}
            {d.error && <div className="mt-1 text-red-700">{d.error}</div>}
          </div>
        ))}
      </div>

      {/* photo */}
      {(p.aiPhoto || p.files.some((x) => x.kind === "passport" && !p.files.some((y) => y.kind === "selfie"))) && (
        <div className="mt-3 flex flex-wrap items-start gap-3 rounded-xl bg-slate-50 p-3">
          {p.aiPhoto ? (
            <PhotoFrame aiPhoto={p.aiPhoto} crop={p.crop ?? DEFAULT_CROP} onCommit={onCrop} />
          ) : (
            <div className="text-xs text-slate-500">ไม่มีเซลฟี่ → จะครอปหน้าจากพาสปอร์ตแล้วสุ่มเสื้อให้</div>
          )}
          <div className="flex min-w-[220px] flex-1 flex-col gap-2 text-xs">
            {(p.photoMode === "passport" || !p.files.some((x) => x.kind === "selfie")) && (
              <label className="block"><span className="text-slate-500">เสื้อผ้า (โหมดพาสปอร์ต)</span>
                <select value={p.cloth ?? ""} onChange={(e) => onChange({ ...p, cloth: e.target.value })} className={inputCls}>
                  <option value="">สุ่ม</option>{clothes.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></label>
            )}
            <span className="text-slate-500">มีรูปพื้นขาวอยู่แล้ว? ลากรูปลงด้านบนแล้วกด "ใช้รูปนี้เลย" ใต้รูป — จะครอป/เลื่อนให้โดยไม่เจนใหม่</span>
            <label className="block"><span className="text-slate-500">คำสั่งเพิ่มสำหรับคนนี้ (เช่น เอากระเป๋าออก) แล้วกด "ทำรูปใหม่"</span>
              <input value={p.photoExtra ?? ""} onChange={(e) => onChange({ ...p, photoExtra: e.target.value })} className={inputCls} /></label>
            {p.aiPhoto && <span className="text-slate-500">ปุ่ม ＋－ ซูม · ลูกศรเลื่อนทีละนิด · หรือลากรูปด้วยเมาส์ · ดับเบิลคลิกดูรูปเต็ม</span>}
          </div>
        </div>
      )}

      {/* fields */}
      <div className="mt-4 grid gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
        <F label="คำนำหน้า"><select value={f.title} onChange={(e) => set("title", e.target.value as PersonFields["title"])} className={inputCls}><option>MR.</option><option>MRS.</option><option>MISS</option></select></F>
        <F label="ชื่อ (given)"><input value={f.firstName} onChange={(e) => set("firstName", e.target.value.toUpperCase())} className={inputCls} /></F>
        <F label="นามสกุล"><input value={f.lastName} onChange={(e) => set("lastName", e.target.value.toUpperCase())} className={inputCls} /></F>
        <F label="ชื่อจีน"><input value={f.chineseName} onChange={(e) => set("chineseName", e.target.value)} className={inputCls} /></F>
        <F label="สัญชาติ"><input value={f.nationality} onChange={(e) => set("nationality", e.target.value.toUpperCase())} className={inputCls} /></F>
        <F label="เลขพาสปอร์ต"><input value={f.passportNo} onChange={(e) => set("passportNo", e.target.value.toUpperCase())} className={inputCls} /></F>

        <F label="วันเกิด"><DateIn value={f.dateOfBirth} onChange={(v) => set("dateOfBirth", v)} /></F>
        <F label="สถานที่เกิด"><input value={f.placeOfBirth} onChange={(e) => set("placeOfBirth", e.target.value.toUpperCase())} className={inputCls} /></F>
        <F label="พาสปอร์ตออก"><DateIn value={f.passportIssueDate} onChange={(v) => set("passportIssueDate", v)} /></F>
        <F label="พาสปอร์ตหมด"><DateIn value={f.passportExpiryDate} onChange={(v) => set("passportExpiryDate", v)} /></F>
        <F label="ออกให้ที่"><input value={f.passportIssuedAt} onChange={(e) => set("passportIssuedAt", e.target.value.toUpperCase())} className={inputCls} /></F>
        <F label="มาจากประเทศ"><input value={f.fromCountry} onChange={(e) => set("fromCountry", e.target.value.toUpperCase())} className={inputCls} /></F>

        <F label="วันเข้าเมือง" hi><DateIn value={f.arrivalDate} onChange={(v) => set("arrivalDate", v)} hi /></F>
        <F label="อยู่ได้ถึง (ตราน้ำเงิน)" hi><DateIn value={f.admittedUntil} onChange={(v) => set("admittedUntil", v)} hi /></F>
        <F label="ด่าน"><input value={f.portOfArrival} onChange={(e) => set("portOfArrival", e.target.value.toUpperCase())} className={inputCls} /></F>
        <F label="โดย"><input value={f.arrivedBy} onChange={(e) => set("arrivedBy", e.target.value.toUpperCase())} className={inputCls} /></F>
        <F label="ประเภทวีซ่า" wide><input value={f.visaType} onChange={(e) => set("visaType", e.target.value.toUpperCase())} className={inputCls} /></F>
        {!isRun && <F label={`หมดอายุใหม่ (หลังต่อ)${(() => { const d = extensionExpiry(f.arrivalDate, f.admittedUntil, f.visaType, meta.extensionDays); return d && !f.newUntil ? ` คำนวณ ${fmtDdmmyyyy(d)}` : ""; })()}`}><DateIn value={f.newUntil ?? ""} onChange={(v) => set("newUntil", v)} /></F>}

        <F label="บ้านเลขที่"><input value={f.houseNo} onChange={(e) => set("houseNo", e.target.value.toUpperCase())} className={inputCls} /></F>
        <F label="ถนน"><input value={f.road} onChange={(e) => set("road", e.target.value.toUpperCase())} className={inputCls} /></F>
        <F label="แขวง/ตำบล"><input value={f.subDistrict} onChange={(e) => set("subDistrict", e.target.value.toUpperCase())} className={inputCls} /></F>
        <F label="เขต/อำเภอ"><input value={f.district} onChange={(e) => set("district", e.target.value.toUpperCase())} className={inputCls} /></F>
        <F label="จังหวัด"><input value={f.province} onChange={(e) => set("province", e.target.value.toUpperCase())} className={inputCls} /></F>
        <F label="รหัสไปรษณีย์"><input value={f.postalCode} onChange={(e) => set("postalCode", e.target.value)} className={inputCls} /></F>

        <F label="เอเจนซี่ / ผู้ส่ง"><AgentPicker value={f.agent} onChange={(v) => set("agent", v)} others={people.map((x) => x.fields.agent)} /></F>
        <F label="เอเจนซี่ย่อย (โน้ตของเอเจนซี่หลัก)"><input value={f.subAgent ?? ""} onChange={(e) => set("subAgent", e.target.value)} className={inputCls} placeholder="ที่เขาโน้ตมา เช่น 小王" /></F>
        <F label="การเงิน">
          <select value={f.pay} onChange={(e) => set("pay", e.target.value as PersonFields["pay"])} className={inputCls}>
            <option value="collect">เก็บเงิน</option><option value="paid">จ่ายแล้ว</option><option value="nocollect">ไม่เก็บ</option>
          </select>
        </F>
        <F label="เก็บหน้างาน (บาท)"><input value={f.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d]/g, ""))} className={inputCls} placeholder="4000" /></F>
        <F label="ราคาเอเจนซี่"><input value={f.agentPrice ?? ""} onChange={(e) => set("agentPrice", e.target.value.replace(/[^\d]/g, ""))} className={inputCls} placeholder="เรียกเก็บเอเจนซี่" /></F>
        <F label="ต้นทุนจริง"><input value={f.cost ?? ""} onChange={(e) => set("cost", e.target.value.replace(/[^\d]/g, ""))} className={inputCls} placeholder="ค่าธรรมเนียม+ปรับ+VIP" /></F>
        <F label="รายการต้นทุน" wide><input value={f.costNote ?? ""} onChange={(e) => set("costNote", e.target.value)} className={inputCls} placeholder="เช่น ค่าธรรมเนียม 1900 + ค่าปรับ 1500 + หนังสือสถานทูต 500" /></F>
        <F label="หมายเหตุ" wide><input value={f.note} onChange={(e) => set("note", e.target.value)} className={inputCls} /></F>
        <F label="โทร"><input value={f.phone} onChange={(e) => set("phone", e.target.value)} className={inputCls} /></F>
      </div>
      <datalist id="today-agents">
        {Array.from(new Set(people.map((x) => x.fields.agent).filter(Boolean))).map((a) => <option key={a} value={a} />)}
      </datalist>
    </section>
  );
}

// Crop preview with drag / wheel; commits a re-rendered print-size JPEG.
function PhotoFrame({ aiPhoto, crop, onCommit }: { aiPhoto: Blob; crop: Crop; onCommit: (crop: Crop, photo: Blob) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const faceRef = useRef<HeadBox | null>(null);
  const cropRef = useRef<Crop>(crop);
  const dragRef = useRef<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const [fullUrl, setFullUrl] = useState("");

  useEffect(() => { cropRef.current = crop; }, [crop]);
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      nudge({ zoom: cropRef.current.zoom * (e.deltaY < 0 ? 1.02 : 1 / 1.02) });
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let alive = true;
    loadImage(aiPhoto).then((img) => {
      if (!alive) return;
      imgRef.current = img;
      faceRef.current = findHeadByBackground(img);
      paint();
    });
    const u = URL.createObjectURL(aiPhoto);
    setFullUrl(u);
    return () => { alive = false; URL.revokeObjectURL(u); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiPhoto]);

  function paint() {
    const img = imgRef.current, c = canvasRef.current;
    if (!img || !c) return;
    drawCrop(img, faceRef.current, cropRef.current, c, 240, 320);
  }
  async function commit() {
    const photo = await renderPhoto(aiPhoto, cropRef.current);
    onCommit({ ...cropRef.current }, photo);
  }
  function nudge(patch: Partial<Crop>) {
    const next = { ...cropRef.current, ...patch };
    next.zoom = Math.min(3, Math.max(0.5, next.zoom));
    next.dx = Math.min(1, Math.max(-1, next.dx));
    next.dy = Math.min(1, Math.max(-1, next.dy));
    cropRef.current = next;
    paint();
    commitSoon();
  }
  const STEP = 0.03;
  const nb = "rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50";

  return (
    <div className="flex flex-col items-center gap-1.5">
    <canvas
      ref={canvasRef}
      width={240}
      height={320}
      className="h-40 w-[120px] cursor-grab rounded border border-slate-300 bg-white"
      title="ลากเพื่อเลื่อน · สกรอลเพื่อซูม"
      onPointerDown={(e) => { dragRef.current = { x: e.clientX, y: e.clientY, dx: cropRef.current.dx, dy: cropRef.current.dy }; e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={(e) => {
        const d = dragRef.current; if (!d) return;
        const rc = e.currentTarget.getBoundingClientRect();
        cropRef.current = { ...cropRef.current, dx: d.dx - (e.clientX - d.x) / rc.width, dy: d.dy - (e.clientY - d.y) / rc.height };
        paint();
      }}
      onPointerUp={() => { if (dragRef.current) { dragRef.current = null; commit(); } }}
      onDoubleClick={() => { if (fullUrl) window.open(fullUrl, "_blank"); }}
    />
    <div className="grid grid-cols-3 gap-1">
      <button type="button" className={nb} onClick={() => nudge({ zoom: cropRef.current.zoom * 1.06 })} title="ซูมเข้า">＋</button>
      <button type="button" className={nb} onClick={() => nudge({ dy: cropRef.current.dy - STEP })} title="เลื่อนขึ้น">▲</button>
      <button type="button" className={nb} onClick={() => nudge({ zoom: cropRef.current.zoom / 1.06 })} title="ซูมออก">－</button>
      <button type="button" className={nb} onClick={() => nudge({ dx: cropRef.current.dx - STEP })} title="เลื่อนซ้าย">◀</button>
      <button type="button" className={nb} onClick={() => nudge({ dy: cropRef.current.dy + STEP })} title="เลื่อนลง">▼</button>
      <button type="button" className={nb} onClick={() => nudge({ dx: cropRef.current.dx + STEP })} title="เลื่อนขวา">▶</button>
    </div>
    <button type="button" className={nb + " w-full"} onClick={() => nudge({ ...DEFAULT_CROP })}>รีเซ็ต</button>
    </div>
  );

  function commitSoon() {
    const w = window as unknown as { __todayCommitTimer?: number };
    if (w.__todayCommitTimer) window.clearTimeout(w.__todayCommitTimer);
    w.__todayCommitTimer = window.setTimeout(commit, 400);
  }
}

// The one-page board the user takes to the counter: photo, EN + CN name,
// agent + payment tag per person; office and issue date at the bottom.
const pill = (bg: string, fg: string, size = 12): React.CSSProperties => ({
  display: "inline-flex", alignItems: "center", justifyContent: "center",
  height: size + 10, lineHeight: 1, padding: "0 9px", borderRadius: 4,
  fontSize: size, fontWeight: 600, background: bg, color: fg, whiteSpace: "nowrap", boxSizing: "border-box",
});
const wrapPill: React.CSSProperties = { whiteSpace: "normal", height: "auto", minHeight: 21, lineHeight: 1.25, padding: "3px 8px", maxWidth: "100%", textAlign: "center" };
const SummarySheet = forwardRef<HTMLDivElement, { people: Person[]; meta: DayMeta; mode: BoardMode; agentFilter?: string }>(function SummarySheet({ people: all, meta, mode, agentFilter = "" }, ref) {
  const o = OFFICES[meta.office];
  const isRun = mode === "run";
  const runSlot = RUN_SLOTS.find((s) => s.id === (meta.slot || "morning"));
  const people = all.filter((p) => !p.cancelled && !p.movedTo);   // counted
  const shown = all;                                                // drawn (ghosts included)
  const [dd, mm, yy] = meta.date.split("/");
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const thDays = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
  const cnDays = ["日", "一", "二", "三", "四", "五", "六"];
  const dateObj = dd && mm && yy ? new Date(Number(yy), Number(mm) - 1, Number(dd)) : null;
  const dateEn = dateObj ? `${dd} ${months[Number(mm) - 1] ?? mm} ${yy}` : meta.date;
  const dateTh = dateObj ? `วัน${thDays[dateObj.getDay()]}ที่ ${Number(dd)}` : "";
  const dateCn = dateObj ? `${yy}年${Number(mm)}月${Number(dd)}日 · 星期${cnDays[dateObj.getDay()]}` : "";
  const collect = people.filter((p) => p.fields.pay === "collect");
  const sum = collect.reduce((s, p) => s + (Number(p.fields.amount) || 0), 0);
  const received = collect.reduce((s, p) => s + ((p.fields.paidHow === "cash" || p.fields.paidHow === "transfer") ? (Number(p.fields.paidAmount || p.fields.amount) || 0) : 0), 0);
  const pendingN = collect.filter((p) => (p.fields.paidHow ?? "pending") === "pending").length;
  const overstays = people.filter((p) => (overstayInfo(p.fields.arrivalDate, p.fields.admittedUntil, p.fields.visaType, meta.date, undefined, !isRun)?.days ?? 0) > 0).length;
  const accent = o.summaryAccent;
  const font = "system-ui, 'Noto Sans Thai', 'Noto Sans SC', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";
  const cols = shown.length <= 6 ? 6 : 8;
  // 8 columns need more room: the name + payment pill under a 90px photo
  // overflow a 900px sheet, so widen it instead of shrinking the cards
  const sheetW = cols === 8 ? 1040 : 900;
  return (
    <div ref={ref} style={{ width: sheetW, padding: 22, background: o.summaryBg, fontFamily: font, position: "relative" }}>
      {/* soft decorative circles */}
      <div style={{ position: "absolute", right: -60, top: -60, width: 220, height: 220, borderRadius: "50%", background: accent, opacity: 0.08 }} />
      <div style={{ position: "absolute", left: -40, bottom: -70, width: 180, height: 180, borderRadius: "50%", background: accent, opacity: 0.06 }} />

      {/* header band */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: accent, color: "#fff", borderRadius: 14, padding: "12px 18px", boxShadow: "0 4px 14px rgba(0,0,0,.15)", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ fontSize: 34, lineHeight: 1 }}>{o.emoji}</div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 0.3, lineHeight: 1.1 }}>{isRun ? `🚗 VISA RUN · ${o.summaryTitle}` : o.summaryTitle}{agentFilter ? <span style={{ marginLeft: 10, fontSize: 15, fontWeight: 700, background: "rgba(255,255,255,.22)", borderRadius: 8, padding: "2px 10px", verticalAlign: "middle" }}>🏢 {agentFilter}</span> : null}</div>
            <div style={{ fontSize: 12, opacity: 0.9, marginTop: 3 }}>{isRun ? `รอบ${runSlot?.th ?? ""}${meta.flight ? ` · ✈ ${meta.flight}` : ""}${meta.landTime ? ` ลง ${meta.landTime}` : ""}${meta.returnBy ? ` · กลับถึงสนามบินก่อน ${meta.returnBy}` : ""}` : `${o.subtitle}${o.generator !== "none" ? ` · ต่อวีซ่า ${meta.extensionDays} วัน` : ""}`}</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.85 }}>📅 ISSUE DATE</div>
          <div style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.2 }}>{dateEn}</div>
          <div style={{ fontSize: 12, opacity: 0.95 }}>{dateTh} · {dateCn}</div>
        </div>
      </div>

      {/* people */}
      <div style={{ background: "rgba(255,255,255,.92)", borderRadius: 14, padding: "18px 16px 14px", marginTop: 12, boxShadow: "0 2px 10px rgba(0,0,0,.06)", position: "relative" }}>
        {shown.length === 0 && <div style={{ textAlign: "center", color: "#999", padding: 30 }}>ยังไม่มีลูกค้า</div>}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "16px 10px" }}>
          {shown.map((p, i) => {
            const ghost = !!(p.cancelled || p.movedTo);
            const f = p.fields;
            const amt = f.amount ? ` ${Number(f.amount).toLocaleString()}` : "";
            // on a per-agent sheet the agent is in the header, so the pill carries their sub-agent note instead
            const who = agentFilter ? (f.subAgent ? `${f.subAgent} ` : "") : (f.agent ? `${f.agent} ` : "");
            const got = f.paidAmount || f.amount ? ` ${Number(f.paidAmount || f.amount).toLocaleString()}` : "";
            const tag = f.pay === "collect"
              ? (f.paidHow === "cash" ? { bg: "#d2f4dd", fg: "#14532d", t: `💵 ${who}รับเงินสดแล้ว${got}` }
                : f.paidHow === "transfer" ? { bg: "#cfe9ff", fg: "#0b3d6b", t: `📲 ${who}โอนแล้ว${got}` }
                : f.paidHow === "agent" ? { bg: "#cfe9ff", fg: "#0b3d6b", t: `🏢 ${who}จ่ายที่เอเจนซี่` }
                : { bg: "#ffe66d", fg: "#4a3b00", t: `💰 ${who}เก็บ${amt}`.trim() })
              : f.pay === "paid" ? { bg: "#d2f4dd", fg: "#14532d", t: `✅ ${who}จ่ายแล้ว` } : { bg: "#dbeafe", fg: "#1e3a8a", t: `🤝 ${who}ไม่เก็บ` };
            const ov = overstayInfo(f.arrivalDate, f.admittedUntil, f.visaType, meta.date, undefined, !isRun);
            return (
              <div key={p.id} style={{ textAlign: "center", position: "relative", opacity: ghost ? 0.75 : 1, minWidth: 0 }}>
                <div style={{ position: "relative", display: "inline-block", filter: ghost ? "grayscale(1)" : undefined }}>
                  <SummaryPhoto person={p} />
                  {p.cancelled && (
                    <span style={{ position: "absolute", inset: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="3.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
                    </span>
                  )}
                  {p.movedTo && (
                    <span style={{ position: "absolute", inset: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h14M13 6l6 6-6 6" /></svg>
                    </span>
                  )}
                  <span style={{ position: "absolute", top: -6, left: -6, width: 22, height: 22, borderRadius: "50%", background: accent, color: "#fff", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }}>{i + 1}</span>
                  {ov && ov.days > 0 && <span style={{ position: "absolute", bottom: -6, right: -6, background: "#dc2626", color: "#fff", borderRadius: 6, fontSize: 10, fontWeight: 700, padding: "2px 5px" }}>⚠ +{ov.days}</span>}
                  {isRun && carById(f.car) && <span style={{ position: "absolute", top: -6, right: -6, background: carById(f.car)!.accent, color: "#fff", borderRadius: 6, fontSize: 10, fontWeight: 700, padding: "2px 5px", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }}>🚗{f.car}</span>}
                  {isRun && f.cambodia && <span style={{ position: "absolute", top: 18, right: -8, fontSize: 22, lineHeight: 1, filter: "drop-shadow(0 1px 2px rgba(0,0,0,.4))" }}>🐻</span>}
                  {isRun && f.run === "RUN30" && <span style={{ position: "absolute", bottom: -6, left: -6, background: "#ea580c", color: "#fff", borderRadius: 6, fontSize: 10, fontWeight: 700, padding: "2px 5px" }}>+30</span>}
                  {p.arrived && (
                    <span style={{ position: "absolute", right: -8, bottom: 10, width: 34, height: 34, borderRadius: "50%", background: "#16a34a", border: "3px solid #fff", boxShadow: "0 2px 6px rgba(0,0,0,.35)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, fontWeight: 700, marginTop: 6, color: "#222", letterSpacing: 0.3 }}>{[f.lastName, f.firstName].filter(Boolean).join(" ") || "\u00a0"}</div>
                <div style={{ fontSize: 15, lineHeight: 1.2, color: "#111" }}>{f.chineseName || "\u00a0"}</div>
                {f.subAgent && <div style={{ fontSize: 10, color: "#4338ca", fontWeight: 700, marginTop: 2 }}>↳ {f.subAgent}</div>}
                <div style={{ marginTop: 5 }}>
                  {/* long tags (agent name + amount) wrap inside the column instead of spilling over the neighbour */}
                  {p.cancelled ? <span style={{ ...pill("#fee2e2", "#991b1b", 11), ...wrapPill }}>❌ ไม่มา</span>
                    : p.movedTo ? <span style={{ ...pill("#dbeafe", "#1e3a8a", 11), ...wrapPill }}>➡ เลื่อนไป {p.movedTo.slice(0, 5)}</span>
                    : <span style={{ ...pill(tag.bg, tag.fg, 11), ...wrapPill }}>{tag.t}</span>}
                </div>
                {f.note && <div style={{ fontSize: 10, color: "#666", marginTop: 3 }}>📝 {f.note}</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, padding: "0 6px", fontSize: 13, color: "#333", position: "relative" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={pill("#fff", accent, 13)}>👥 {people.length} คน</span>
          {people.some((p) => p.arrived) && <span style={pill("#16a34a", "#fff", 13)}>✓ มาแล้ว {people.filter((p) => p.arrived).length}/{people.length}</span>}
          {pendingN > 0 && <span style={pill("#ffe66d", "#4a3b00", 13)}>💰 ต้องเก็บ {pendingN} คน รวม {sum.toLocaleString()} บาท</span>}
          {received > 0 && <span style={pill("#d2f4dd", "#14532d", 13)}>💵 รับแล้ว {received.toLocaleString()} บาท</span>}
          {collect.length === 0 && people.length > 0 && <span style={pill("#d2f4dd", "#14532d", 13)}>✅ ไม่มีรายการเก็บเงิน</span>}
          {overstays > 0 && <span style={pill("#fee2e2", "#991b1b", 13)}>⚠ overstay {overstays} คน</span>}
          {isRun && <span style={pill("#e0e7ff", "#3730a3", 13)}>🚗 {CARS.filter((c) => people.some((p) => p.fields.car === c.id)).length} คัน</span>}
          {isRun && people.some((p) => p.fields.run === "RUN30") && <span style={pill("#ffedd5", "#9a3412", 13)}>📄 ไปต่อ 30 วัน {people.filter((p) => p.fields.run === "RUN30").length}</span>}
          {shown.some((p) => p.cancelled) && <span style={pill("#fee2e2", "#991b1b", 13)}>❌ ไม่มา {shown.filter((p) => p.cancelled).length}</span>}
          {shown.some((p) => p.movedTo) && <span style={pill("#dbeafe", "#1e3a8a", 13)}>➡ เลื่อนวัน {shown.filter((p) => p.movedTo).length}</span>}
        </div>
        {/* the tri-lingual slogan is only for A-Tao's own per-agent sheet; the combined sheet and other agents' sheets stay plain */}
        {/อาเต่า/.test(agentFilter) && (
          <div style={{ textAlign: "right", lineHeight: 1.25 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: accent, letterSpacing: 1 }}>诚信经营 · 用心服务</div>
            <div style={{ fontSize: 11, color: "#444" }}>ซื่อสัตย์ จริงใจ ใส่ใจบริการ</div>
            <div style={{ fontSize: 10, color: "#555", fontStyle: "italic" }}>Integrity in Business, Care in Service</div>
          </div>
        )}
      </div>
    </div>
  );
});

function SummaryPhoto({ person: p }: { person: Person }) {
  const blob = p.photo ?? p.files.find((x) => x.kind === "selfie")?.blob ?? p.files.find((x) => x.kind === "passport")?.blob ?? null;
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) { setUrl(""); return; }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" style={{ width: 90, height: 120, objectFit: "cover", borderRadius: 4, boxShadow: "0 1px 3px rgba(0,0,0,.25)" }} /> : <div style={{ width: 90, height: 120, background: "#eee", borderRadius: 4, margin: "0 auto" }} />;
}

function Thumb({ doc }: { doc: DocFile }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (doc.mime === "application/pdf") { setUrl(""); return; }
    const u = URL.createObjectURL(doc.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [doc.blob, doc.mime]);
  if (doc.mime === "application/pdf") {
    return <div className="flex h-20 items-center justify-center rounded bg-slate-100 text-xs font-semibold text-slate-600">PDF</div>;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt={doc.name} className="h-20 w-full cursor-zoom-in rounded object-cover" onClick={() => window.open(url, "_blank")} /> : <div className="h-20 rounded bg-slate-100" />;
}

function DropZone({ onFiles, disabled }: { onFiles: (f: FileList | File[]) => void; disabled: boolean }) {
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) onFiles(files);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [onFiles]);
  return (
    <div
      onClick={() => !disabled && ref.current?.click()}
      onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) onFiles(e.dataTransfer.files); }}
      className={`cursor-pointer rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${over ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-white"} ${disabled ? "opacity-60" : ""}`}
    >
      <p className="text-base font-semibold text-slate-800">ลากรูปทั้งวันลงที่นี่ — พาสปอร์ต ตราเข้าเมือง เซลฟี่ และ TM30 (PDF) ปนกันได้</p>
      <p className="mt-1 text-xs text-slate-500">ระบบจัดกลุ่มตามลำดับไฟล์: พาสปอร์ตใบใหม่ = คนใหม่ รูปถัดไปเป็นของคนนั้น · วางจากคลิปบอร์ดได้ (Ctrl+V)</p>
      <input ref={ref} type="file" multiple accept="image/*,.pdf" hidden onChange={(e) => { if (e.target.files) onFiles(e.target.files); e.target.value = ""; }} />
    </div>
  );
}

// ---------- small UI bits ----------

const inputCls = "w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30";
const inputHiCls = "w-full rounded-md border border-yellow-400 bg-yellow-50 px-2 py-1.5 text-sm font-semibold text-yellow-900 focus:outline-none";
const btnCls = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimaryCls = "rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-300";
const btnDangerCls = "rounded-lg border border-red-200 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50";

// Dropdown of the main agents (most frequent first) + ลูกค้าตรง + any other
// name already used today; "อื่น ๆ" opens a text box for a new agent.
function AgentPicker({ value, onChange, others }: { value: string; onChange: (v: string) => void; others: string[] }) {
  const known = [...MAIN_AGENTS, DIRECT_CUSTOMER];
  const extra = Array.from(new Set(others.filter((a) => a && !known.includes(a))));
  const isKnown = !value || known.includes(value) || extra.includes(value);
  const [custom, setCustom] = useState(!isKnown);
  const showText = custom || !isKnown;
  return (
    <div className="flex gap-1">
      <select value={showText ? "__other" : value} onChange={(e) => { const v = e.target.value; if (v === "__other") { setCustom(true); onChange(""); } else { setCustom(false); onChange(v); } }} className={inputCls + (showText ? " w-24 shrink-0" : "")}>
        <option value="">— เลือก —</option>
        {MAIN_AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
        <option value={DIRECT_CUSTOMER}>👤 {DIRECT_CUSTOMER}</option>
        {extra.length > 0 && <optgroup label="วันนี้">{extra.map((a) => <option key={a} value={a}>{a}</option>)}</optgroup>}
        <option value="__other">✏️ อื่น ๆ (พิมพ์)</option>
      </select>
      {showText && <input autoFocus={custom && !value} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} placeholder="ชื่อเอเจนซี่ใหม่" />}
    </div>
  );
}

function F({ label, children, hi, wide }: { label: string; children: React.ReactNode; hi?: boolean; wide?: boolean }) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className={`mb-0.5 block text-[11px] ${hi ? "font-semibold text-yellow-800" : "text-slate-500"}`}>{label}</span>
      {children}
    </label>
  );
}

// "1845" → "18:45"
function formatTimeMask(raw: string): string {
  const d = raw.replace(/[^\d]/g, "").slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
}
function formatDateMask(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function DateIn({ value, onChange, hi }: { value: string; onChange: (v: string) => void; hi?: boolean }) {
  return <input value={value} onChange={(e) => onChange(formatDateMask(e.target.value))} placeholder="DD/MM/YYYY" inputMode="numeric" maxLength={10} className={hi ? inputHiCls : inputCls} />;
}
