"use client";

// =============================================================
// /today — งานวันนี้ (daily board)
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
  DEFAULT_META, EMPTY_FIELDS, ddmmyyyyToIso, loadHolidays, newId, overstayInfo, saveHolidays,
  personFolderName, todayDdmmyyyy,
  type DayMeta, type DocFile, type DocType, type Person, type PersonFields,
} from "@/lib/today/types";
import { clearAll, deletePerson, loadAll, saveMeta, savePerson } from "@/lib/today/store";
import { OFFICES, OFFICE_IDS, isOfficeId, type OfficeId } from "@/lib/offices";
import {
  billUrl, buildCollectImage, buildDayZip, buildTm30Excel, downloadBlob, downscaleImage, loadScript, mergePdfs, plusDaysDdmmyyyy,
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

export default function TodayPage() {
  const [people, setPeople] = useState<Person[]>([]);
  const [meta, setMeta] = useState<DayMeta>({ ...DEFAULT_META });
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [photoSettings, setPhotoSettings] = useState<PhotoSettings>(PHOTO_SETTINGS_DEFAULT);
  const [showSettings, setShowSettings] = useState(false);
  const [holidays, setHolidays] = useState<string[]>([]);
  const [summaryBlob, setSummaryBlob] = useState<Blob | null>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const peopleRef = useRef<Person[]>([]);
  useEffect(() => { peopleRef.current = people; }, [people]);

  // ---------- load / persist ----------
  useEffect(() => {
    loadAll().then(({ people: p, meta: m }) => {
      setPeople(p);
      const merged = { ...DEFAULT_META, ...(m ?? {}), date: m?.date || todayDdmmyyyy() };
      if (!isOfficeId(merged.office)) merged.office = DEFAULT_META.office;
      setMeta(merged);
      setLoaded(true);
    });
    setPhotoSettings(loadPhotoSettings());
    setHolidays(loadHolidays());
  }, []);

  function updatePhotoSettings(patch: Partial<PhotoSettings>) {
    setPhotoSettings((prev) => {
      const next = { ...prev, ...patch };
      try { localStorage.setItem("today-photo-settings", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  function changeOffice(office: OfficeId) {
    updateMeta({ office, jobType: OFFICES[office].short, formLocation: OFFICES[office].formLocation });
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
  }, []);

  function patchPerson(id: string, fn: (p: Person) => Person) {
    const cur = peopleRef.current.find((x) => x.id === id);
    if (!cur) return;
    upsertPerson(fn(cur));
  }

  function removePerson(id: string) {
    setPeople((prev) => prev.filter((x) => x.id !== id));
    deletePerson(id);
  }

  function nextOrder(): number {
    return peopleRef.current.reduce((m, p) => Math.max(m, p.order), 0) + 1;
  }

  function addEmptyPerson(): Person {
    const p: Person = { id: newId(), order: nextOrder(), fields: { ...EMPTY_FIELDS }, files: [], createdAt: Date.now() };
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
        const base: Person = byNo ?? { id: newId(), order: nextOrder() + touched.size, fields: { ...EMPTY_FIELDS }, files: [], createdAt: Date.now() };
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
          target = { id: newId(), order: nextOrder() + touched.size, fields: { ...EMPTY_FIELDS, firstName: who?.firstName ?? "", lastName: who?.lastName ?? "", passportNo: who?.passportNo ?? "" }, files: [], createdAt: Date.now() };
        }
      }
      if (!target) target = current ?? existing().slice(-1)[0] ?? null;
      if (!target) {
        target = { id: newId(), order: nextOrder() + touched.size, fields: { ...EMPTY_FIELDS }, files: [], createdAt: Date.now() };
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

  async function tm7All() {
    const ready = people.filter((p) => p.fields.firstName && p.fields.lastName && p.fields.passportNo);
    if (!ready.length) { setError("ยังไม่มีคนที่ข้อมูลครบ (ชื่อ นามสกุล เลขพาสปอร์ต)"); return; }
    setWorking(true); setError("");
    const blobs: Blob[] = [];
    try {
      for (let i = 0; i < ready.length; i++) {
        setStatus(`กำลังทำ TM7 ${i + 1}/${ready.length} — ${personFolderName(ready[i])}`);
        const blob = await generateTm7(ready[i]);
        patchPerson(ready[i].id, (x) => ({ ...x, tm7Pdf: blob }));
        blobs.push(blob);
      }
      setStatus("กำลังรวม PDF…");
      const merged = await mergePdfs(blobs);
      downloadBlob(merged, `TM7-${meta.jobType}-${meta.date.replace(/\//g, "")}-${ready.length}คน.pdf`);
      setStatus(`TM7 ครบ ${ready.length} คน รวมเป็นไฟล์เดียวแล้ว`);
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
    const todo = people.filter((p) => !p.photo && p.files.some((x) => x.kind === "selfie" || x.kind === "passport"));
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

  function updateCrop(id: string, crop: Crop, photo: Blob) {
    patchPerson(id, (x) => ({ ...x, crop, photo }));
  }

  async function photoSheet(): Promise<Blob | null> {
    const photos = people.filter((p) => p.photo).map((p) => p.photo as Blob);
    if (!photos.length) return null;
    return buildPhotoSheetPdf(photos);
  }
  async function downloadPhotoSheet() {
    setError("");
    try {
      const blob = await photoSheet();
      if (!blob) { setError("ยังไม่มีรูปพื้นขาวของใครเลย"); return; }
      downloadBlob(blob, `photo-sheet_${meta.date.replace(/\//g, "")}.pdf`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function makeSummary(): Promise<Blob | null> {
    const el = summaryRef.current;
    if (!el || !people.length) return null;
    await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
    const h2c = (window as unknown as { html2canvas: (el: HTMLElement, o: Record<string, unknown>) => Promise<HTMLCanvasElement> }).html2canvas;
    const canvas = await h2c(el, { scale: 2, backgroundColor: "#ffffff", useCORS: true });
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (blob) setSummaryBlob(blob);
    return blob;
  }
  async function downloadSummary() {
    setError("");
    try {
      const blob = await makeSummary();
      if (!blob) return;
      downloadBlob(blob, `summary_${meta.date.replace(/\//g, "")}_${meta.jobType}.png`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  // ---------- collect-amount image + bill ----------
  async function collectOne(p: Person, download = true): Promise<Blob | null> {
    const passport = p.files.find((x) => x.kind === "passport");
    const amount = Number(p.fields.amount) || 0;
    if (!passport) { setError(`${personFolderName(p)}: ไม่มีรูปพาสปอร์ต`); return null; }
    if (!amount) { setError(`${personFolderName(p)}: ยังไม่ใส่ยอดเงิน`); return null; }
    const blob = await buildCollectImage(passport.blob, amount, p.fields.agent ? p.fields.agent : "");
    patchPerson(p.id, (x) => ({ ...x, collectImage: blob }));
    if (download) downloadBlob(blob, `เก็บ-${amount}-${personFolderName(p)}.jpg`);
    return blob;
  }
  async function collectAll() {
    const todo = people.filter((p) => p.fields.pay === "collect" && Number(p.fields.amount) > 0 && p.files.some((x) => x.kind === "passport"));
    if (!todo.length) { setError("ยังไม่มีคนที่ต้องเก็บเงิน + มียอด + มีพาสปอร์ต"); return; }
    setError("");
    for (const p of todo) await collectOne(p, true);
    setStatus(`รูปเรียกเก็บ ${todo.length} รูป`);
  }
  function openBill(list: Person[]) {
    const amount = list.length === 1 ? Number(list[0].fields.amount) || 0 : list.reduce((s, p) => s + (Number(p.fields.amount) || 0), 0);
    window.open(billUrl(list, amount), "_blank");
  }

  async function excelTm30() {
    const ready = people.filter((p) => p.fields.firstName && p.fields.passportNo);
    if (!ready.length) { setError("ยังไม่มีคนที่มีชื่อและเลขพาสปอร์ต"); return; }
    try {
      const blob = await buildTm30Excel(ready, plusDaysDdmmyyyy(10));
      downloadBlob(blob, `TM30_${meta.date.replace(/\//g, "")}_${ready.length}คน.xls`);
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
      const blob = await buildDayZip(people, meta, { photoSheet: sheet ?? undefined, summary: summary ?? undefined });
      downloadBlob(blob, `${meta.date.replace(/\//g, "")}_${meta.jobType}.zip`);
      setStatus("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorking(false);
    }
  }

  async function clearDay() {
    if (!window.confirm("ล้างรายการทั้งวันนี้? (ไฟล์ที่ยังไม่ได้ดาวน์โหลดจะหายไป)")) return;
    await clearAll();
    setPeople([]);
    updateMeta({ date: todayDdmmyyyy() });
    setStatus("");
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
  const collect = people.filter((p) => p.fields.pay === "collect");
  const collectSum = collect.reduce((s, p) => s + (Number(p.fields.amount) || 0), 0);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">งานวันนี้</h1>
          <p className="text-sm text-slate-600">โยนรูปจาก LINE ทั้งวันลงทีเดียว → ระบบแยกคน อ่านข้อมูล ทำฟอร์ม ทำ Excel TM30 และโฟลเดอร์ให้</p>
        </div>
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs text-slate-500">วันที่ยื่น</span>
            <input value={meta.date} onChange={(e) => updateMeta({ date: formatDateMask(e.target.value) })} className={inputCls + " w-32"} placeholder="DD/MM/YYYY" />
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
        </div>
      </header>

      <DropZone onFiles={handleFiles} disabled={working} />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-slate-700">
          <span className="font-semibold">{people.length}</span> คน
          {collect.length > 0 && <span className="ml-3 rounded bg-yellow-100 px-2 py-0.5 text-yellow-900">ต้องเก็บ {collect.length} คน รวม {collectSum.toLocaleString()} บาท</span>}
          {status && <span className="ml-3 text-slate-500">{status}</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => addEmptyPerson()} className={btnCls}>+ เพิ่มคนว่าง</button>
          <button onClick={excelTm30} disabled={working || !people.length} className={btnCls}>⬇ Excel TM30</button>
          <button onClick={tm7All} disabled={working || !people.length} className={btnPrimaryCls}>⬇ TM7 ทุกคน (PDF เดียว)</button>
          <button onClick={photosAll} disabled={working || !people.length} className={btnPrimaryCls}>✦ ทำรูปพื้นขาวทุกคน</button>
          <button onClick={downloadPhotoSheet} disabled={working || !people.some((p) => p.photo)} className={btnCls}>⬇ แผ่น A4 รูป (PDF)</button>
          <button onClick={downloadSummary} disabled={working || !people.length} className={btnCls}>⬇ Summary (PNG)</button>
          <button onClick={collectAll} disabled={working || !people.length} className={btnCls}>฿ รูปเรียกเก็บทุกคน</button>
          <button onClick={() => openBill(people.filter((p) => p.fields.pay === "collect"))} disabled={!people.some((p) => p.fields.pay === "collect")} className={btnCls} title="บิลรวมคนที่ต้องเก็บเงิน (สูงสุด 5 คน)">🧾 บิลรวม</button>
          <button onClick={() => setShowSettings((v) => !v)} className={btnCls} title="ตั้งค่ารูป">⚙</button>
          <button onClick={dayZip} disabled={working || !people.length} className={btnCls}>⬇ โฟลเดอร์วันนี้ (zip)</button>
          <button onClick={clearDay} disabled={working} className={btnDangerCls}>ล้างวัน</button>
        </div>
      </div>

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

      <div className="mt-6 space-y-4">
        {loaded && people.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">ยังไม่มีลูกค้าวันนี้ — ลากรูปลงด้านบน</p>
        )}
        {people.map((p) => (
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
            clothes={clothesList()}
            onMoveFile={(fileId, toId) => moveFile(p.id, fileId, toId)}
            holidays={holidays}
            busy={working}
          />
        ))}
      </div>

      {/* one-page summary (rendered off-screen, exported with html2canvas) */}
      <div className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">ตัวอย่าง Summary</h2>
        <div className="overflow-auto rounded-2xl ring-1 ring-slate-200">
          <SummarySheet ref={summaryRef} people={people} meta={meta} />
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
  person: p, people, meta, onChange, onRemove, onTm7, onPhoto, onCollect, onBill, onCrop, clothes, onMoveFile, holidays, busy,
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
  clothes: string[];
  onMoveFile: (fileId: string, toPersonId: string) => void;
  holidays: string[];
  busy: boolean;
}) {
  const f = p.fields;
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
  const ov = overstayInfo(f.arrivalDate, f.admittedUntil, f.visaType, meta.date, holidays);
  const overstayDays = ov?.days ?? 0;
  const fine = ov?.fine ?? 0;
  const missing: string[] = [];
  if (!f.firstName || !f.lastName) missing.push("ชื่อ");
  if (!f.passportNo) missing.push("เลขพาสปอร์ต");
  if (!f.arrivalDate) missing.push("วันเข้าเมือง");
  if (!f.houseNo && !f.province) missing.push("ที่อยู่ (TM30)");
  const hasSelfie = p.files.some((x) => x.kind === "selfie");

  return (
    <section className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ${fine ? "ring-red-300" : "ring-slate-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-slate-900 px-2.5 py-1 text-sm font-bold text-white">{String(p.order).padStart(2, "0")}</span>
          <div>
            <div className="text-base font-semibold text-slate-900">
              {[f.lastName, f.firstName].filter(Boolean).join(" ") || <span className="text-slate-400">ยังไม่มีชื่อ</span>}
              {f.chineseName && <span className="ml-2 text-slate-600">{f.chineseName}</span>}
            </div>
            <div className="text-xs text-slate-500">
              {f.passportNo || "—"} · {f.nationality || "—"}
              {p.tm7Pdf && <span className="ml-2 rounded bg-emerald-100 px-1.5 text-emerald-800">TM7 แล้ว</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onTm7} disabled={busy} className={btnCls}>TM7 PDF</button>
          <button onClick={onPhoto} disabled={busy} className={btnCls}>{p.aiPhoto ? "ทำรูปใหม่" : "✦ ทำรูปพื้นขาว"}</button>
          {f.pay === "collect" && <button onClick={onCollect} disabled={busy} className={btnCls} title="รูปพาสปอร์ตพร้อมยอดที่ต้องเก็บ">฿ รูปเรียกเก็บ</button>}
          <button onClick={onBill} className={btnCls} title="เปิดโปรแกรมบิล ABC พร้อมชื่อ/พาสปอร์ต/ยอด">🧾 ออกบิล</button>
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

        <F label="บ้านเลขที่"><input value={f.houseNo} onChange={(e) => set("houseNo", e.target.value.toUpperCase())} className={inputCls} /></F>
        <F label="ถนน"><input value={f.road} onChange={(e) => set("road", e.target.value.toUpperCase())} className={inputCls} /></F>
        <F label="แขวง/ตำบล"><input value={f.subDistrict} onChange={(e) => set("subDistrict", e.target.value.toUpperCase())} className={inputCls} /></F>
        <F label="เขต/อำเภอ"><input value={f.district} onChange={(e) => set("district", e.target.value.toUpperCase())} className={inputCls} /></F>
        <F label="จังหวัด"><input value={f.province} onChange={(e) => set("province", e.target.value.toUpperCase())} className={inputCls} /></F>
        <F label="รหัสไปรษณีย์"><input value={f.postalCode} onChange={(e) => set("postalCode", e.target.value)} className={inputCls} /></F>

        <F label="เอเจนซี่ / ผู้ส่ง"><input value={f.agent} onChange={(e) => set("agent", e.target.value)} className={inputCls} list="today-agents" /></F>
        <F label="การเงิน">
          <select value={f.pay} onChange={(e) => set("pay", e.target.value as PersonFields["pay"])} className={inputCls}>
            <option value="collect">เก็บเงิน</option><option value="paid">จ่ายแล้ว</option><option value="nocollect">ไม่เก็บ</option>
          </select>
        </F>
        <F label="บาท"><input value={f.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d]/g, ""))} className={inputCls} placeholder="4000" /></F>
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
const SummarySheet = forwardRef<HTMLDivElement, { people: Person[]; meta: DayMeta }>(function SummarySheet({ people, meta }, ref) {
  const [dd, mm, yy] = meta.date.split("/");
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const dateEn = dd && mm && yy ? `${dd} ${months[Number(mm) - 1] ?? mm} ${yy}` : meta.date;
  const dateCn = dd && mm && yy ? `${yy}年 ${Number(mm)}月 ${Number(dd)}日` : "";
  const collect = people.filter((p) => p.fields.pay === "collect");
  const sum = collect.reduce((s, p) => s + (Number(p.fields.amount) || 0), 0);
  return (
    <div ref={ref} style={{ width: 900, padding: 24, background: OFFICES[meta.office].summaryBg, fontFamily: "system-ui, 'Noto Sans Thai', 'Noto Sans SC', sans-serif" }}>
      <div style={{ background: "#fff", borderRadius: 10, padding: 18, minHeight: 360 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: "14px 8px" }}>
          {people.map((p) => {
            const f = p.fields;
            const amt = f.amount ? ` ${Number(f.amount).toLocaleString()}` : "";
            const who = f.agent ? `${f.agent} ` : "";
            const tag = f.pay === "collect" ? { bg: "#ffe66d", fg: "#4a3b00", t: `${who}เก็บ${amt}`.trim() }
              : f.pay === "paid" ? { bg: "#cfe9ff", fg: "#0b3d6b", t: `${who}จ่ายแล้ว` } : { bg: "#cfe9ff", fg: "#0b3d6b", t: `${who}ไม่เก็บ` };
            return (
              <div key={p.id} style={{ textAlign: "center" }}>
                <SummaryPhoto person={p} />
                <div style={{ fontSize: 10, fontWeight: 600, marginTop: 5, color: "#222", letterSpacing: 0.3 }}>{[f.firstName, f.lastName].filter(Boolean).join(" ") || "\u00a0"}</div>
                <div style={{ fontSize: 15, lineHeight: 1.2 }}>{f.chineseName || "\u00a0"}</div>
                <div style={{ marginTop: 4 }}><span style={pill(tag.bg, tag.fg)}>{tag.t}</span></div>
                {f.note && <div style={{ fontSize: 10, color: "#666", marginTop: 2 }}>{f.note}</div>}
              </div>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 18 }}>
          <div>
            <span style={{ ...pill(OFFICES[meta.office].summaryAccent, "#fff", 20), height: 40, padding: "0 16px", borderRadius: 8, fontWeight: 700 }}>{OFFICES[meta.office].summaryTitle}</span>
            <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>{people.length} คน</div>
          </div>
          <div style={{ textAlign: "right", fontSize: 13, color: "#333" }}>
            <div style={{ fontSize: 12, letterSpacing: 1, color: "#555" }}>ISSUE DATE</div>
            <div style={{ marginTop: 3 }}><span style={pill("#ffe66d", "#4a3b00", 13)}>{dateEn}</span></div>
            <div style={{ marginTop: 4 }}><span style={pill("#ffe66d", "#4a3b00", 13)}>{dateCn}</span></div>
            <div style={{ marginTop: 4 }}>{collect.length ? `ต้องเก็บ ${collect.length} คน รวม ${sum.toLocaleString()} บาท` : "ไม่มีรายการเก็บเงิน"}</div>
          </div>
        </div>
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

function F({ label, children, hi, wide }: { label: string; children: React.ReactNode; hi?: boolean; wide?: boolean }) {
  return (
    <label className={`block ${wide ? "sm:col-span-2" : ""}`}>
      <span className={`mb-0.5 block text-[11px] ${hi ? "font-semibold text-yellow-800" : "text-slate-500"}`}>{label}</span>
      {children}
    </label>
  );
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
