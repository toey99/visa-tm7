// =============================================================
// TM.7 Master PDF Generator
// =============================================================
// Loads the 5-page master template (tm7-master.pdf) and overlays
// applicant data onto the form fields.
//
// Pages:
//   1-2: TM.7 form (personal details, address)
//   3:   STM.2
//   4:   STM.9 / Overstay
//   5:   STM.11
// =============================================================

import { PDFDocument, PDFPage, rgb } from "pdf-lib";
import { passportDateFields } from "./tm7-passport-dates";
import fs from "fs";
import path from "path";

export type Title = "MR." | "MRS." | "MISS";

export type Tm7FormData = {
  // Personal
  title: Title;
  firstName: string;
  lastName: string;
  nationality: string;
  dateOfBirth?: string;          // ISO yyyy-mm-dd
  placeOfBirth?: string;

  // Passport
  passportNo: string;
  passportIssueDate?: string;    // ISO
  passportExpiryDate?: string;   // ISO
  passportIssuedAt?: string;

  // Arrival
  arrivalDate?: string;          // ISO
  fromCountry?: string;
  portOfArrival?: string;
  arrivedBy?: string;
  visaType?: string;

  // Address in Thailand
  houseNo?: string;
  road?: string;
  subDistrict?: string;
  district?: string;
  province?: string;
  postalCode?: string;
  phone?: string;

  // Extension
  appointmentDate?: string;      // ISO — used as form date
  formLocation?: string;         // e.g. BANGKOK
  extensionDays?: number;        // default 30
  extensionReason?: string;      // default TOURISM
};

// ── PRODUCTION LAYOUT ─────────────────────────────────────────
// The layout coordinate grid (light gray/red gridlines + numeric
// labels) used during fine-tuning has been fully removed. All field
// coordinates for Pages 1–5 are now hard-coded production constants
// in generateTm7Pdf below and must not be altered. The renderer emits
// clean output with zero debug overhead.

// ── Female-element offset system (LOCKED) ─────────────────────
// The Male (MR.) layout in generateTm7Pdf is finalized and
// pixel-perfect. To keep it untouched while letting the female forms
// be positioned independently, every field is drawn through
// drawFieldText / drawFieldLine with a stable key. For MRS./MISS
// applicants a per-key { dx, dy } shift from FEMALE_OFFSETS is added
// to that field's base coordinates; for MR. applicants NO shift is
// ever applied, so the Male layout is guaranteed unchanged. A key
// that is absent means "no shift" (0, 0).
//
// +dx = right, −dx = left. +dy = up, −dy = down (PDF y-axis).
//
// Lines (drawFieldLine) additionally support an optional `dw`
// (delta-width) that lengthens a horizontal line toward the LEFT by
// `dw` units — the right endpoint stays put and the left endpoint is
// pushed further left. `dw` is applied on top of any dx/dy shift.
//
// These values are LOCKED production constants: verified pixel-perfect
// across all female pages. Do not alter without re-verifying output.
type Offset = { dx: number; dy: number; dw?: number };
const NO_OFFSET: Offset = Object.freeze({ dx: 0, dy: 0 });

const FEMALE_OFFSETS: Readonly<Record<string, Offset>> = Object.freeze({
  // Page 1 title line: 2× length, extended toward the left. The base
  // female line is 15 units wide (x 137.5→152.5); dw:15 lengthens it
  // to 30 by pushing the left endpoint out to x 122.5.
  "p1.titleLine": { dx: 12, dy: 0, dw: 15 },
  // Page 3 title line: shift left by 16 units.
  "p3.titleLine": { dx: -16, dy: 0 },
  // Page 4 title line: shift left by 16 units.
  "p4.titleLine": { dx: -16, dy: 0 },
});

let cachedTemplate: Uint8Array | null = null;
let cachedTemplateMtimeMs = 0;
let cachedFont: Uint8Array | null = null;

async function loadTemplate(): Promise<Uint8Array> {
  const p = path.join(process.cwd(), "public", "templates", "tm7-master.pdf");
  // Cache-bust on the file's mtime: re-read whenever tm7-master.pdf changes
  // on disk so an updated template is picked up without restarting the server.
  const mtimeMs = fs.statSync(p).mtimeMs;
  if (cachedTemplate && mtimeMs === cachedTemplateMtimeMs) return cachedTemplate;
  cachedTemplate = new Uint8Array(fs.readFileSync(p));
  cachedTemplateMtimeMs = mtimeMs;
  return cachedTemplate;
}

async function loadFont(): Promise<Uint8Array> {
  if (cachedFont) return cachedFont;
  const p = path.join(process.cwd(), "public", "fonts", "Sarabun-Regular.ttf");
  cachedFont = new Uint8Array(fs.readFileSync(p));
  return cachedFont;
}

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

function parseDate(s: string | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function splitDate(d: Date | null): { day: string; month: string; year: string } {
  if (!d) return { day: "", month: "", year: "" };
  return {
    day: d.getDate().toString(),
    month: MONTHS[d.getMonth()],
    year: d.getFullYear().toString(),
  };
}

function calcAge(dob: Date | null): string {
  if (!dob) return "";
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const m = today.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
  return age.toString();
}

export async function generateTm7Pdf(
  data: Tm7FormData,
  tm30Pdf?: Uint8Array,
): Promise<Uint8Array> {
  const templateBytes = await loadTemplate();
  const pdfDoc = await PDFDocument.load(templateBytes);

  const fontkit = (await import("@pdf-lib/fontkit")).default;
  pdfDoc.registerFontkit(fontkit);

  const fontBytes = await loadFont();
  const font = await pdfDoc.embedFont(fontBytes);

  const pages = pdfDoc.getPages();
  const [page1, page2, page3, page4, page5] = pages;

  const S = 11;
  const C = rgb(0.1, 0.2, 0.8); // ballpoint blue

  // ── Merge data ───────────────────────────────────────────────
  const firstName = data.firstName.toUpperCase();
  const lastName = data.lastName.toUpperCase();
  const nationality = data.nationality.toUpperCase();
  const passportNo = data.passportNo.toUpperCase();
  const applicantTitle = data.title;
  const titledName = `${applicantTitle} ${lastName} ${firstName}`.replace(/\s+/g, " ").trim();

  const formLocation = (data.formLocation || "BANGKOK").toUpperCase();
  const extensionDays = (data.extensionDays ?? 30).toString();
  const extensionReason = (data.extensionReason || "TOURISM").toUpperCase();
  const portOfArrival = (data.portOfArrival || "").toUpperCase();
  const arrivedBy = (data.arrivedBy || "").toUpperCase();
  const fromCountry = (data.fromCountry || "").toUpperCase();
  const placeOfBirth = (data.placeOfBirth || "").toUpperCase();
  const passportIssuedAt = (data.passportIssuedAt || "").toUpperCase();
  const visaType = (data.visaType || "").toUpperCase();

  const dob = parseDate(data.dateOfBirth);
  const calculatedAge = calcAge(dob);
  const dobParts = splitDate(dob);

  const formDateSource = parseDate(data.appointmentDate) || new Date();
  const formDate = splitDate(formDateSource);
  const printDate = formDateSource
    .toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" })
    .toUpperCase();

  const issueDateObj = parseDate(data.passportIssueDate);
  const expiryDateObj = parseDate(data.passportExpiryDate);
  const arrivalDateObj = parseDate(data.arrivalDate);

  const fmtDay = (d: Date | null) =>
    d ? d.toLocaleDateString("en-GB", { day: "2-digit" }) : "";
  const fmtMonthLong = (d: Date | null) =>
    d ? d.toLocaleDateString("en-GB", { month: "long" }).toUpperCase().trim() : "";
  const fmtYear = (d: Date | null) =>
    d ? d.toLocaleDateString("en-GB", { year: "numeric" }) : "";

  const arrDay = fmtDay(arrivalDateObj);
  const arrMonth = fmtMonthLong(arrivalDateObj);
  const arrYear = fmtYear(arrivalDateObj);

  const houseNo = (data.houseNo || "").trim();
  const road = (data.road || "").trim();
  const subDistrict = (data.subDistrict || "").trim();
  const district = (data.district || "").trim();
  const province = (data.province || "").trim();
  const postalCode = (data.postalCode || "").trim();
  const phone = (data.phone || "").trim();
  const provinceZip = postalCode ? `${province} ${postalCode}` : province;
  const fullAddress = `${houseNo} ${road}, ${subDistrict}, ${district}, ${provinceZip}`;
  const lineThickness = 1.5;

  // ── Female-element offset system ─────────────────────────────
  // Male (MR.) applicants get no shift, so their locked layout is
  // guaranteed unchanged. MRS./MISS applicants pick up the per-key
  // shift from the module-level FEMALE_OFFSETS production constants.
  const isFemale = applicantTitle !== "MR.";

  const offset = (key: string): Offset =>
    isFemale ? FEMALE_OFFSETS[key] ?? NO_OFFSET : NO_OFFSET;

  const drawFieldText = (
    page: PDFPage,
    key: string,
    str: string,
    opts: { x: number; y: number; size: number; font: typeof font; color: typeof C },
  ) => {
    const o = offset(key);
    page.drawText(str, { ...opts, x: opts.x + o.dx, y: opts.y + o.dy });
  };

  const drawFieldLine = (
    page: PDFPage,
    key: string,
    opts: {
      start: { x: number; y: number };
      end: { x: number; y: number };
      thickness: number;
      color: typeof C;
    },
  ) => {
    const o = offset(key);
    let startX = opts.start.x + o.dx;
    let endX = opts.end.x + o.dx;
    // dw lengthens the line toward the left: keep the right endpoint
    // fixed and push the left (smaller-x) endpoint further left by dw.
    const dw = o.dw ?? 0;
    if (dw) {
      if (startX <= endX) startX -= dw;
      else endX -= dw;
    }
    page.drawLine({
      ...opts,
      start: { x: startX, y: opts.start.y + o.dy },
      end: { x: endX, y: opts.end.y + o.dy },
    });
  };

  // ── Page 1: TM.7 personal details ──────────────────────────
  // Male layout LOCKED. Female fields shift via FEMALE_OFFSETS keys.
  drawFieldText(page1, "p1.formLocation", formLocation, { x: 450, y: 708, size: 12, font, color: C });

  drawFieldText(page1, "p1.formDay", formDate.day, { x: 350, y: 660, size: 12, font, color: C });
  drawFieldText(page1, "p1.formMonth", formDate.month, { x: 405, y: 660, size: 12, font, color: C });
  drawFieldText(page1, "p1.formYear", formDate.year, { x: 510, y: 660, size: 12, font, color: C });

  const surnameY = 578;
  const titleEngY = surnameY - 15;
  if (applicantTitle === "MR.") {
    drawFieldLine(page1, "p1.titleLine", {
      start: { x: 160, y: titleEngY - 6 },
      end: { x: 185, y: titleEngY - 6 },
      thickness: lineThickness, color: C,
    });
  } else {
    drawFieldLine(page1, "p1.titleLine", {
      start: { x: 137.5, y: titleEngY - 6 },
      end: { x: 152.5, y: titleEngY - 6 },
      thickness: lineThickness, color: C,
    });
  }

  drawFieldText(page1, "p1.lastName", lastName, { x: 285, y: 578, size: 12, font, color: C });
  drawFieldText(page1, "p1.firstName", firstName, { x: 435, y: 578, size: 12, font, color: C });
  drawFieldText(page1, "p1.dash", "-", { x: 175, y: 541, size: 12, font, color: C });
  drawFieldText(page1, "p1.placeOfBirth", placeOfBirth, { x: 175, y: 505, size: 12, font, color: C });
  drawFieldText(page1, "p1.nationality", nationality, { x: 460, y: 505, size: 12, font, color: C });

  if (dob) {
    drawFieldText(page1, "p1.dobDay", dobParts.day, { x: 375, y: 541, size: 12, font, color: C });
    drawFieldText(page1, "p1.dobMonth", dobParts.month, { x: 445, y: 541, size: 12, font, color: C });
    drawFieldText(page1, "p1.dobYear", dobParts.year, { x: 525, y: 541, size: 12, font, color: C });
  }
  drawFieldText(page1, "p1.age", calculatedAge, { x: 285, y: 541, size: 12, font, color: C });

  drawFieldText(page1, "p1.portOfArrival", portOfArrival, { x: 150, y: 332, size: 12, font, color: C });
  drawFieldText(page1, "p1.arrivedBy", arrivedBy, { x: 185, y: 368, size: 12, font, color: C });

  // Passport issue/expiry day-month-year: geometry and value pairing live
  // in tm7-passport-dates so the two dates cannot be transposed here.
  for (const f of passportDateFields(issueDateObj, expiryDateObj)) {
    drawFieldText(page1, f.key, f.value, { x: f.x, y: f.y, size: 12, font, color: C });
  }
  drawFieldText(page1, "p1.passportIssuedAt", passportIssuedAt, { x: 300, y: 436, size: 12, font, color: C });
  drawFieldText(page1, "p1.visaType", visaType, { x: 350, y: 406, size: 12, font, color: C });
  drawFieldText(page1, "p1.fromCountry", fromCountry, { x: 350, y: 368, size: 12, font, color: C });
  drawFieldText(page1, "p1.arrDay", arrDay, { x: 350, y: 332, size: 12, font, color: C });
  drawFieldText(page1, "p1.arrMonth", arrMonth, { x: 415, y: 332, size: 12, font, color: C });
  drawFieldText(page1, "p1.arrYear", arrYear, { x: 510, y: 332, size: 12, font, color: C });

  drawFieldText(page1, "p1.passportNo", passportNo, { x: 330, y: 478, size: 12, font, color: C });
  drawFieldText(page1, "p1.extensionDays", extensionDays, { x: 475, y: 268, size: 12, font, color: C });
  drawFieldText(page1, "p1.extensionReason", extensionReason, { x: 275, y: 196, size: 12, font, color: C });

  // ── Page 2: TM.7 continuation + address ───────────────────
  // LOCKED — coordinates finalized and verified; do not change.
  drawFieldText(page2, "p2.titledName", titledName, { x: 250, y: 722, size: S, font, color: C });

  const addressLine1Y = 680;
  const addressLine2Y = 640;
  const fullAddressY = addressLine2Y + 115;

  drawFieldText(page2, "p2.houseNo", houseNo, { x: 150, y: addressLine1Y, size: 12, font, color: C });
  drawFieldText(page2, "p2.road", road, { x: 245, y: addressLine1Y, size: 12, font, color: C });
  drawFieldText(page2, "p2.subDistrict", subDistrict, { x: 440, y: addressLine1Y, size: 12, font, color: C });
  drawFieldText(page2, "p2.district", district, { x: 150, y: addressLine2Y, size: 12, font, color: C });
  drawFieldText(page2, "p2.provinceZip", provinceZip, { x: 365, y: addressLine2Y, size: 12, font, color: C });
  if (phone) {
    drawFieldText(page2, "p2.phone", phone, { x: 150, y: addressLine2Y - 40, size: 12, font, color: C });
  }
  drawFieldText(page2, "p2.fullAddress", fullAddress, { x: 175, y: fullAddressY, size: 8, font, color: C });

  // ── Page 3: STM.2 ──────────────────────────────────────────
  // LOCKED — coordinates finalized and verified; do not change.
  drawFieldText(page3, "p3.lastName", lastName, { x: 170, y: 335, size: S, font, color: C });
  drawFieldText(page3, "p3.firstName", firstName, { x: 220, y: 335, size: S, font, color: C });
  drawFieldText(page3, "p3.printDate", printDate, { x: 450, y: 365, size: S, font, color: C });
  drawFieldText(page3, "p3.nationality", nationality, { x: 450, y: 335, size: 12, font, color: C });
  drawFieldText(page3, "p3.age", calculatedAge, { x: 320, y: 335, size: 12, font, color: C });
  drawFieldText(page3, "p3.extensionReason", extensionReason, { x: 450, y: 320, size: 12, font, color: C });

  const p3LineY = 335;
  if (applicantTitle === "MR.") {
    drawFieldLine(page3, "p3.titleLine", { start: { x: 115, y: p3LineY }, end: { x: 158, y: p3LineY }, thickness: lineThickness, color: C });
  } else {
    drawFieldLine(page3, "p3.titleLine", { start: { x: 115, y: p3LineY }, end: { x: 145, y: p3LineY }, thickness: lineThickness, color: C });
  }

  // ── Page 4: STM.9 / Overstay ──────────────────────────────
  // LOCKED — coordinates finalized and verified; do not change.
  drawFieldText(page4, "p4.lastName", lastName, { x: 250, y: 550, size: S, font, color: C });
  drawFieldText(page4, "p4.firstName", firstName, { x: 400, y: 550, size: S, font, color: C });
  drawFieldText(page4, "p4.formDay", formDate.day, { x: 380, y: 590, size: 12, font, color: C });
  drawFieldText(page4, "p4.formMonth", formDate.month, { x: 440, y: 590, size: 12, font, color: C });
  drawFieldText(page4, "p4.formYear", formDate.year, { x: 525, y: 590, size: 12, font, color: C });
  drawFieldText(page4, "p4.formLocation", formLocation, { x: 450, y: 625, size: 12, font, color: C });
  drawFieldText(page4, "p4.dash", "-", { x: 300, y: 650, size: 12, font, color: C });
  drawFieldText(page4, "p4.age", calculatedAge, { x: 180, y: 515, size: 12, font, color: C });
  drawFieldText(page4, "p4.nationality", nationality, { x: 290, y: 515, size: 12, font, color: C });
  drawFieldText(page4, "p4.passportNo", passportNo, { x: 450, y: 515, size: 12, font, color: C });

  const p4LineY = 530;
  if (applicantTitle === "MR.") {
    drawFieldLine(page4, "p4.titleLine", { start: { x: 120, y: p4LineY }, end: { x: 155, y: p4LineY }, thickness: lineThickness, color: C });
  } else {
    drawFieldLine(page4, "p4.titleLine", { start: { x: 120, y: p4LineY }, end: { x: 149, y: p4LineY }, thickness: lineThickness, color: C });
  }

  // ── Page 5: STM.11 ────────────────────────────────────────
  // Last name (นามสกุล): keep X, Y +3. First name (ชื่อ): X +50 (was +100), Y +3.
  // The two names are drawn separately so each can shift independently,
  // while p5FirstNameX preserves the original combined column layout.
  const p5NameY = 352;
  const p5LastNameX = 200;
  drawFieldText(page5, "p5.lastName", lastName, { x: p5LastNameX, y: p5NameY, size: S, font, color: C });
  const p5FirstNameX = p5LastNameX + font.widthOfTextAtSize(`${lastName}       `, S);
  drawFieldText(page5, "p5.firstName", firstName, { x: p5FirstNameX + 50, y: p5NameY, size: S, font, color: C });
  // Date (วันเดือนปี): X −5, Y +3.
  drawFieldText(page5, "p5.printDate", printDate, { x: 495, y: 388, size: S, font, color: C });

  // Title line (เส้น): keep X, Y +3.
  const p5LineY = 354.5;
  if (applicantTitle === "MR.") {
    drawFieldLine(page5, "p5.titleLine", { start: { x: 125, y: p5LineY }, end: { x: 175, y: p5LineY }, thickness: lineThickness, color: C });
  } else {
    drawFieldLine(page5, "p5.titleLine", { start: { x: 115, y: p5LineY }, end: { x: 145, y: p5LineY }, thickness: lineThickness, color: C });
  }

  // Age (อายุ): keep X, Y aligned to First/Last name baseline (p5NameY).
  drawFieldText(page5, "p5.age", calculatedAge, { x: 490, y: p5NameY, size: 12, font, color: C });
  // Race/Ethnicity (เชื้อชาติ) & Passport No. share this baseline: keep X, Y +2.
  const p5RaceY = 336;
  drawFieldText(page5, "p5.nationality", nationality, { x: 125, y: p5RaceY, size: 12, font, color: C });
  // Passport No. (เลขที่ passport): keep X, Y aligned to Race/Ethnicity baseline.
  drawFieldText(page5, "p5.passportNo", passportNo, { x: 300, y: p5RaceY, size: 12, font, color: C });

  const p5Address = [houseNo, road, subDistrict, district, provinceZip]
    .filter(Boolean)
    .join(", ");
  const p5AddressFull = phone ? `${p5Address}, Tel: ${phone}` : p5Address;
  // Address (ที่อยู่): keep X, Y −3.
  drawFieldText(page5, "p5.address", p5AddressFull, { x: 200, y: 240, size: 10, font, color: C });

  // Mark 'x': X +2, Y +1.
  drawFieldText(page5, "p5.mark", "X", { x: 107, y: 268.5, size: 12, font, color: C });
  // TOURISM: keep X, Y −3.
  drawFieldText(page5, "p5.extensionReason", extensionReason, { x: 225, y: 257.5, size: 12, font, color: C });
  // Bottom name (ชื่อที่อยู่ด้านล่าง): keep X, Y −10.
  drawFieldText(page5, "p5.bottomName", titledName, { x: 165, y: 220.5, size: 12, font, color: C });

  // Pages 1–5 layout is finalized: every coordinate above is a
  // hard-coded production constant and no debug overlay is drawn.

  // ── Append the uploaded TM.30 as the final page(s) ─────────
  // The applicant's original TM.30 receipt is copied verbatim and
  // appended after page 5, so the generated packet ends with the
  // exact TM.30 PDF they uploaded during the address scan step.
  if (tm30Pdf && tm30Pdf.byteLength > 0) {
    const tm30Doc = await PDFDocument.load(tm30Pdf);
    const tm30Pages = await pdfDoc.copyPages(tm30Doc, tm30Doc.getPageIndices());
    for (const p of tm30Pages) pdfDoc.addPage(p);
  }

  return await pdfDoc.save();
}
