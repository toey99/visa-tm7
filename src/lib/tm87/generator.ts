// =============================================================
// TM.87 — Application for visa (คำขอรับการตรวจลงตรา)
// =============================================================
// Two-page official form (public/templates/tm87.pdf, 595.22 × 842 pt). The
// template has a text layer, so each field sits on the baseline of its own
// printed label, just to the right of it; positions below were read from
// the template. Dates are written the way the form asks: day / month name /
// year, in English (the same convention as the TM.7 pages). Units: PDF
// points, origin bottom-left.
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";

export type Tm87Data = {
  office: string;              // สำนักงานตรวจคนเข้าเมือง ...  e.g. "BANGKOK"
  date: string;                // ISO yyyy-mm-dd (form date; today by default)
  title: "MR." | "MRS." | "MISS" | "";
  lastName: string;
  firstName: string;
  middleName?: string;
  dateOfBirth?: string;        // ISO
  placeOfBirth?: string;
  nationality: string;
  passportNo: string;
  passportIssueDate?: string;  // ISO
  passportIssuedAt?: string;
  passportExpiryDate?: string; // ISO
  visaKind?: string;           // kind of visa currently held, e.g. "TOURIST", "EXEMPTION"
  arrivedBy?: string;          // e.g. AIRPLANE
  fromCountry?: string;
  portOfArrival?: string;
  arrivalDate?: string;        // ISO
  tm6No?: string;
  reason?: string;             // reason(s) for application (one or two lines)
  addressInThailand?: string;  // free text, one line
  writer?: string;             // "This application is written by" — defaults to the applicant
  houseNo?: string; road?: string; subDistrict?: string; district?: string; province?: string;
};

const MONTHS = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
function parts(iso?: string): { d: string; m: string; y: string } {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { d: "", m: "", y: "" };
  const [y, m, d] = iso.split("-");
  return { d: String(Number(d)), m: MONTHS[Number(m) - 1] ?? "", y };
}
function age(iso?: string, at?: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "";
  const b = new Date(iso + "T00:00:00Z"), n = at && /^\d{4}-\d{2}-\d{2}$/.test(at) ? new Date(at + "T00:00:00Z") : new Date();
  let a = n.getUTCFullYear() - b.getUTCFullYear();
  if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) a--;
  return a >= 0 ? String(a) : "";
}

let cachedTemplate: Uint8Array | null = null;
let cachedFont: Uint8Array | null = null;
const loadTemplate = () => (cachedTemplate ??= new Uint8Array(fs.readFileSync(path.join(process.cwd(), "public", "templates", "tm87.pdf"))));
const loadFont = () => (cachedFont ??= new Uint8Array(fs.readFileSync(path.join(process.cwd(), "public", "fonts", "Sarabun-Regular.ttf"))));

// (x, y) = left end of the text baseline, just right of the printed label
const P1 = {
  office: { x: 434, y: 669 },
  day: { x: 328, y: 639 }, month: { x: 395, y: 639 }, year: { x: 500, y: 639 },
  title: { x: 140, y: 574 },                       // written above "(นาย/นาง/นางสาว)" so it does not collide
  lastName: { x: 228, y: 562 }, firstName: { x: 412, y: 562 },
  middleName: { x: 84, y: 531 }, age: { x: 292, y: 531 }, dobDay: { x: 358, y: 531 }, dobMonth: { x: 412, y: 531 }, dobYear: { x: 508, y: 531 },
  placeOfBirth: { x: 98, y: 501 }, nationality: { x: 374, y: 501 },
  passportNo: { x: 250, y: 471 }, issDay: { x: 527, y: 471 },
  issMonth: { x: 78, y: 441 }, issYear: { x: 157, y: 441 }, issuedAt: { x: 216, y: 441 }, expDay: { x: 525, y: 441 },
  expMonth: { x: 78, y: 410 }, expYear: { x: 175, y: 410 }, visaKind: { x: 314, y: 410 },
  arrivedBy: { x: 122, y: 380 }, fromCountry: { x: 344, y: 380 },
  port: { x: 108, y: 350 }, arrDay: { x: 358, y: 350 }, arrMonth: { x: 412, y: 350 }, arrYear: { x: 508, y: 350 },
  tm6: { x: 200, y: 319 },
  reason1: { x: 158, y: 259 }, reason2: { x: 60, y: 236 },
} as const;
const P2 = {
  address: { x: 146, y: 745 },
  writer: { x: 208, y: 715 },
  houseNo: { x: 102, y: 685 }, road: { x: 186, y: 685 }, subDistrict: { x: 380, y: 685 },
  district: { x: 84, y: 654 }, province: { x: 292, y: 654 },
  photo: { x: 78, y: 317, w: 113, h: 170 },
} as const;

/** Fill the TM.87 template. `photo` (JPEG/PNG bytes) goes in the 4×6 cm box on page 2. */
export async function generateTm87Pdf(data: Tm87Data, photo?: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(loadTemplate());
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(loadFont());
  const [p1, p2] = doc.getPages();
  const C = rgb(0.1, 0.2, 0.8);
  const S = 10.5;
  const LIFT = 3.2;   // the measured y is the dotted line itself; sit the letters just above it
  const up = (s?: string) => (s ?? "").trim().toUpperCase();
  const draw = (page: typeof p1, f: { x: number; y: number }, v: string, size = S, maxW?: number) => {
    if (!v) return;
    let s = size;
    if (maxW) while (s > 7 && font.widthOfTextAtSize(v, s) > maxW) s -= 0.5;
    page.drawText(v, { x: f.x, y: f.y + LIFT, size: s, font, color: C });
  };

  const fd = parts(data.date), dob = parts(data.dateOfBirth), iss = parts(data.passportIssueDate), exp = parts(data.passportExpiryDate), arr = parts(data.arrivalDate);
  draw(p1, P1.office, up(data.office), S, 112);
  draw(p1, P1.day, fd.d); draw(p1, P1.month, fd.m, S, 80); draw(p1, P1.year, fd.y);
  draw(p1, P1.title, up(data.title), 8);
  draw(p1, P1.lastName, up(data.lastName), S, 160); draw(p1, P1.firstName, up(data.firstName), S, 136);
  draw(p1, P1.middleName, up(data.middleName) || "-", S, 180); draw(p1, P1.age, age(data.dateOfBirth, data.date));
  draw(p1, P1.dobDay, dob.d); draw(p1, P1.dobMonth, dob.m, S, 74); draw(p1, P1.dobYear, dob.y);
  draw(p1, P1.placeOfBirth, up(data.placeOfBirth), S, 240); draw(p1, P1.nationality, up(data.nationality), S, 170);
  draw(p1, P1.passportNo, up(data.passportNo), S, 250); draw(p1, P1.issDay, iss.d);
  draw(p1, P1.issMonth, iss.m, S, 58); draw(p1, P1.issYear, iss.y); draw(p1, P1.issuedAt, up(data.passportIssuedAt), S, 240); draw(p1, P1.expDay, exp.d);
  draw(p1, P1.expMonth, exp.m, S, 74); draw(p1, P1.expYear, exp.y); draw(p1, P1.visaKind, up(data.visaKind), S, 230);
  draw(p1, P1.arrivedBy, up(data.arrivedBy), S, 200); draw(p1, P1.fromCountry, up(data.fromCountry), S, 200);
  draw(p1, P1.port, up(data.portOfArrival), S, 220); draw(p1, P1.arrDay, arr.d); draw(p1, P1.arrMonth, arr.m, S, 74); draw(p1, P1.arrYear, arr.y);
  draw(p1, P1.tm6, up(data.tm6No), S, 200);
  const reason = up(data.reason);
  if (reason) {
    // split over two lines if it does not fit after the label
    const fits = (s: string, w: number) => font.widthOfTextAtSize(s, S) <= w;
    if (fits(reason, 380)) draw(p1, P1.reason1, reason);
    else {
      const words = reason.split(/\s+/); let l1 = "";
      while (words.length && fits(`${l1} ${words[0]}`.trim(), 380)) l1 = `${l1} ${words.shift()}`.trim();
      draw(p1, P1.reason1, l1); draw(p1, P1.reason2, words.join(" "), S, 480);
    }
  }

  const applicant = [up(data.title), up(data.firstName), up(data.lastName)].filter(Boolean).join(" ");
  const addr = data.addressInThailand?.trim() || [data.houseNo, data.road, data.subDistrict, data.district, data.province].filter(Boolean).join(", ");
  draw(p2, P2.address, up(addr), S, 400);
  draw(p2, P2.writer, up(data.writer) || applicant, S, 300);
  draw(p2, P2.houseNo, up(data.houseNo), S, 60); draw(p2, P2.road, up(data.road), S, 146); draw(p2, P2.subDistrict, up(data.subDistrict), S, 170);
  draw(p2, P2.district, up(data.district), S, 176); draw(p2, P2.province, up(data.province), S, 190);

  if (photo?.length) {
    try {
      const img = photo[0] === 0x89 ? await doc.embedPng(photo) : await doc.embedJpg(photo);
      const box = P2.photo;
      const scale = Math.min(box.w / img.width, box.h / img.height);     // fit inside the box, centred
      const w = img.width * scale, h = img.height * scale;
      p2.drawImage(img, { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, width: w, height: h });
    } catch { /* unreadable photo: leave the box empty */ }
  }
  return doc.save();
}
