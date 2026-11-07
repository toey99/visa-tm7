// =============================================================
// STM.9 — Acknowledgement of penalties for visa overstay
// =============================================================
// Appended as page 4 for Chiang Saen (Rayong uses the same 3-page TM.7
// but does not require this sheet). The template is the office's scan,
// normalised to a portrait 595.2 × 841.92 pt page
// (public/templates/stm9.pdf). It has no text layer, so the field
// positions below were measured from the scan. Units: PDF points,
// origin bottom-left; (x, y) is the left end of the text baseline.

import path from "node:path";
import { readFile } from "node:fs/promises";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";

const TEMPLATE_PATH = path.join(process.cwd(), "public", "templates", "stm9.pdf");

export const STM9_FIELDS = {
  location: { x: 415, y: 668 },   // ที่ทำการ / Location
  day: { x: 380, y: 623 },        // วัน
  month: { x: 432, y: 623 },      // เดือน (MMM)
  year: { x: 516, y: 623 },       // พ.ศ. (printed as A.D. year, same as the TM.7 pages)
  lastName: { x: 256, y: 580 },   // ชื่อสกุล / Family name
  firstName: { x: 405, y: 580 },  // ชื่อตัว / Given name
  middleName: { x: 110, y: 540 }, // ชื่อรอง
  age: { x: 186, y: 548 },        // อายุ
  nationality: { x: 272, y: 548 },
  passportNo: { x: 432, y: 548 },
} as const;

export type Stm9Data = {
  location: string;
  day: string;
  month: string;
  year: string;
  lastName: string;
  firstName: string;
  middleName?: string;
  age: string;
  nationality: string;
  passportNo: string;
};

/** Copy the STM.9 template page into `doc`, filled with `data`, and return it. */
export async function appendStm9(doc: PDFDocument, font: PDFFont, data: Stm9Data) {
  const tpl = await PDFDocument.load(await readFile(TEMPLATE_PATH));
  const [page] = await doc.copyPages(tpl, [0]);
  doc.addPage(page);
  const color = rgb(0.1, 0.2, 0.8);
  const draw = (key: keyof typeof STM9_FIELDS, value: string, size = 11) => {
    if (!value) return;
    const f = STM9_FIELDS[key];
    page.drawText(value, { x: f.x, y: f.y, size, font, color });
  };
  draw("location", data.location);
  draw("day", data.day);
  draw("month", data.month);
  draw("year", data.year);
  draw("lastName", data.lastName);
  draw("firstName", data.firstName);
  draw("middleName", data.middleName || "-");
  draw("age", data.age);
  draw("nationality", data.nationality);
  draw("passportNo", data.passportNo);
  return page;
}
