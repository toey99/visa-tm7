// =============================================================
// TM.7 Master PDF Generator
// =============================================================
// Loads the 3-page template (public/templates/tm7-rayong.pdf) and
// overlays applicant data onto the form fields.
//
// Pages:
//   1-2: TM.7 form (personal details, address)
//   3:   STM.2 (English-only edition) — coordinates in tm7-page3-fields.ts
// =============================================================

import { PDFDocument, PDFPage, rgb } from "pdf-lib";
import fs from "fs";
import path from "path";
import { passportDateFields } from "./tm7-passport-dates.ts";
import { officeFormLocation, type OfficeId } from "./offices.ts";
import { uppercaseTm7Data } from "./tm7-normalize.ts";
import {
  PAGE3_INDEX,
  PAGE3_LINE_THICKNESS,
  PAGE3_TITLE_STRIKES,
  page3TextOps,
} from "./tm7-page3-fields.ts";
import { appendStm9 } from "./stm9.ts";

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
  office: OfficeId;              // RAYONG | CHIANG_SAEN — printed location comes from offices.ts
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
});

let cachedTemplate: Uint8Array | null = null;
let cachedTemplateMtimeMs = 0;
let cachedFont: Uint8Array | null = null;

const TEMPLATE_PATH = path.join(process.cwd(), "public", "templates", "tm7-rayong.pdf");
const TEMPLATE_PAGES = 3;

async function loadTemplate(): Promise<Uint8Array> {
  const p = TEMPLATE_PATH;
  // No fallback template: a missing file must fail loudly.
  if (!fs.existsSync(p)) throw new Error(`TM7 template not found: ${p}`);
  // Cache-bust on the file's mtime: re-read whenever the template changes
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
  input: Tm7FormData,
  tm30Pdf?: Uint8Array,
): Promise<Uint8Array> {
  // Safety net: every free-text field is uppercased before drawing.
  const data = uppercaseTm7Data(input);
  const templateBytes = await loadTemplate();
  const pdfDoc = await PDFDocument.load(templateBytes);
  const templatePages = pdfDoc.getPageCount();
  console.log(`[TM7] template=${TEMPLATE_PATH} pages=${templatePages}`);
  if (templatePages !== TEMPLATE_PAGES) {
    throw new Error(
      `TM7 template ${TEMPLATE_PATH} has ${templatePages} pages; expected ${TEMPLATE_PAGES} (wrong file copied?)`,
    );
  }

  const fontkit = (await import("@pdf-lib/fontkit")).default;
  pdfDoc.registerFontkit(fontkit);

  const fontBytes = await loadFont();
  const font = await pdfDoc.embedFont(fontBytes);

  const pages = pdfDoc.getPages();
  const [page1, page2] = pages;
  const page3 = pages[PAGE3_INDEX];

  const S = 11;
  const C = rgb(0.1, 0.2, 0.8); // ballpoint blue

  // ── Merge data ───────────────────────────────────────────────
  const firstName = data.firstName.toUpperCase();
  const lastName = data.lastName.toUpperCase();
  const nationality = data.nationality.toUpperCase();
  const passportNo = data.passportNo.toUpperCase();
  const applicantTitle = data.title;
  const titledName = `${applicantTitle} ${lastName} ${firstName}`.replace(/\s+/g, " ").trim();

  const formLocation = officeFormLocation(data.office);
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

  // Passport Date of issue / Valid until: geometry + values live in
  // tm7-passport-dates so the two dates cannot be transposed here.
  for (const f of passportDateFields(data.passportIssueDate, data.passportExpiryDate)) {
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
  // Phone is intentionally NOT printed on page 2 (it stays in the form
  // and in Tm7FormData for other uses).
  drawFieldText(page2, "p2.fullAddress", fullAddress, { x: 175, y: fullAddressY, size: 8, font, color: C });

  // ── Page 3: STM.2 (English-only edition) ───────────────────
  // All coordinates live in PAGE3_FIELDS / PAGE3_TITLE_STRIKES
  // (src/lib/tm7-page3-fields.ts) so each fix is a one-number change.
  for (const op of page3TextOps({
    printDate,
    lastName,
    firstName,
    age: calculatedAge,
    nationality,
    extensionReason,
  })) {
    page3.drawText(op.value, { x: op.x, y: op.y, size: op.size, font, color: C });
  }
  for (const s of PAGE3_TITLE_STRIKES[applicantTitle]) {
    page3.drawLine({
      start: { x: s.x1, y: s.y },
      end: { x: s.x2, y: s.y },
      thickness: PAGE3_LINE_THICKNESS,
      color: C,
    });
  }

  // ── Page 4 (Chiang Saen only): STM.9 overstay acknowledgement ──
  if (data.office === "CHIANG_SAEN") {
    const dobDate = parseDate(data.dateOfBirth);
    await appendStm9(pdfDoc, font, {
      location: formLocation,
      day: formDate.day,
      month: formDate.month,
      year: formDate.year,
      lastName,
      firstName,
      age: calcAge(dobDate),
      nationality,
      passportNo,
    });
  }

  // ── Append the uploaded TM.30 as the final page(s) ─────────
  // The applicant's original TM.30 receipt is copied verbatim and
  // appended after page 3, so the generated packet ends with the
  // exact TM.30 PDF they uploaded during the address scan step.
  if (tm30Pdf && tm30Pdf.byteLength > 0) {
    const tm30Doc = await PDFDocument.load(tm30Pdf);
    const tm30Pages = await pdfDoc.copyPages(tm30Doc, tm30Doc.getPageIndices());
    for (const p of tm30Pages) pdfDoc.addPage(p);
  }

  return await pdfDoc.save();
}
