// Browser-side helpers for the /today board: image downscaling, CDN script
// loading (JSZip / SheetJS are loaded on demand so the app adds no npm deps),
// the TM.30 bulk-upload Excel, the per-day folder zip and PDF merging.

import type { DayMeta, Person } from "./types";
import { personFolderName } from "./types";

// ---------- images ----------

// Downscale to ≤ maxEdge px JPEG so uploads stay well under the 4.5 MB server
// action limit and IndexedDB stays small. PDFs pass through untouched.
export async function downscaleImage(file: File, maxEdge = 1800, quality = 0.9): Promise<Blob> {
  if (!file.type.startsWith("image/")) return file;
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("image decode failed"));
      i.src = url;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    if (scale === 1 && file.type === "image/jpeg" && file.size < 2.5 * 1024 * 1024) return file;
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, "image/jpeg", quality));
    return blob ?? file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- CDN scripts ----------

const loaded = new Map<string, Promise<void>>();
export function loadScript(src: string): Promise<void> {
  const existing = loaded.get(src);
  if (existing) return existing;
  const p = new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`โหลดสคริปต์ไม่ได้: ${src}`));
    document.head.appendChild(s);
  });
  loaded.set(src, p);
  return p;
}

type JSZipLike = {
  folder(name: string): JSZipLike | null;
  file(name: string, data: Blob | string): JSZipLike;
  generateAsync(opts: { type: "blob"; compression?: string }): Promise<Blob>;
};
type XLSXLike = {
  utils: {
    aoa_to_sheet(rows: (string | null)[][]): Record<string, unknown>;
    book_new(): Record<string, unknown>;
    book_append_sheet(wb: Record<string, unknown>, ws: Record<string, unknown>, name: string): void;
  };
  write(wb: Record<string, unknown>, opts: { bookType: string; type: "array" }): ArrayBuffer;
};

async function getJSZip(): Promise<new () => JSZipLike> {
  await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js");
  return (window as unknown as { JSZip: new () => JSZipLike }).JSZip;
}
async function getXLSX(): Promise<XLSXLike> {
  await loadScript("https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js");
  return (window as unknown as { XLSX: XLSXLike }).XLSX;
}

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// ---------- TM.30 bulk-upload Excel (same headers as the immigration template) ----------

const TM30_HEADERS = [
  "ชื่อ\nFirst Name *",
  "ชื่อกลาง\nMiddle Name",
  "นามสกุล\nLast Name",
  "เพศ\nGender *",
  "เลขหนังสือเดินทาง\nPassport No. *",
  "สัญชาติ\nNationality *",
  "วัน เดือน ปี เกิด\nBirth Date\nDD/MM/YYYY(ค.ศ. / A.D.) \nเช่น 17/06/1985 หรือ 10/00/1985 หรือ 00/00/1985",
  "วันที่แจ้งออกจากที่พัก\nCheck-out Date\nDD/MM/YYYY(ค.ศ. / A.D.) \nเช่น 14/06/2023",
  "เบอร์โทรศัพท์\nPhone No.",
];

// Demonym → ICAO 3-letter code for the nationalities this office sees most.
const DEMONYM_TO_ICAO: Record<string, string> = {
  CHINESE: "CHN", TAIWANESE: "TWN", "HONG KONG": "HKG", MALAYSIAN: "MYS", SINGAPOREAN: "SGP",
  AMERICAN: "USA", BRITISH: "GBR", RUSSIAN: "RUS", KOREAN: "KOR", "SOUTH KOREAN": "KOR", JAPANESE: "JPN",
  INDIAN: "IND", VIETNAMESE: "VNM", INDONESIAN: "IDN", FILIPINO: "PHL", AUSTRALIAN: "AUS", CANADIAN: "CAN",
  GERMAN: "DEU", FRENCH: "FRA", ITALIAN: "ITA", SPANISH: "ESP", DUTCH: "NLD", SWISS: "CHE", SWEDISH: "SWE",
  NORWEGIAN: "NOR", DANISH: "DNK", FINNISH: "FIN", BELGIAN: "BEL", AUSTRIAN: "AUT", POLISH: "POL",
  UKRAINIAN: "UKR", KAZAKH: "KAZ", MONGOLIAN: "MNG", CAMBODIAN: "KHM", LAO: "LAO", LAOTIAN: "LAO",
  BURMESE: "MMR", MYANMAR: "MMR", BANGLADESHI: "BGD", PAKISTANI: "PAK", NEPALESE: "NPL", "SRI LANKAN": "LKA",
  ISRAELI: "ISR", TURKISH: "TUR", IRANIAN: "IRN", EMIRATI: "ARE", SAUDI: "SAU", EGYPTIAN: "EGY",
  BRAZILIAN: "BRA", MEXICAN: "MEX", ARGENTINE: "ARG", "NEW ZEALANDER": "NZL", IRISH: "IRL", PORTUGUESE: "PRT",
  CZECH: "CZE", HUNGARIAN: "HUN", ROMANIAN: "ROU", GREEK: "GRC", THAI: "THA", MACANESE: "MAC",
};
export function icaoFromNationality(n: string): string {
  const key = (n || "").toUpperCase().trim();
  if (/^[A-Z]{3}$/.test(key)) return key;
  return DEMONYM_TO_ICAO[key] ?? "";
}

export function plusDaysDdmmyyyy(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

export async function buildTm30Excel(people: Person[], checkout: string): Promise<Blob> {
  const XLSX = await getXLSX();
  const rows = people.map((p) => {
    const f = p.fields;
    const given = f.firstName.trim().split(/\s+/).filter(Boolean);
    return [
      given[0] ?? "",
      given.slice(1).join(" ") || null,
      f.lastName,
      f.title === "MR." ? "M" : f.title ? "F" : "",
      f.passportNo,
      icaoFromNationality(f.nationality),
      f.dateOfBirth,
      checkout || null,
      f.phone || null,
    ];
  });
  const ws = XLSX.utils.aoa_to_sheet([TM30_HEADERS, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "แบบแจ้งที่พัก Inform Accom");
  const out = XLSX.write(wb, { bookType: "xls", type: "array" });
  return new Blob([out], { type: "application/vnd.ms-excel" });
}

// ---------- merged TM.7 PDF for printing ----------

export async function mergePdfs(blobs: Blob[]): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (const b of blobs) {
    const src = await PDFDocument.load(await b.arrayBuffer());
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((pg) => out.addPage(pg));
  }
  const bytes = await out.save();
  return new Blob([bytes as unknown as BlobPart], { type: "application/pdf" });
}

// ---------- the day as a folder tree ----------
//   DDMMYYYY/<jobType>/01 LAST FIRST/{passport,stamp,selfie}.jpg, tm30.pdf, TM7-LAST FIRST.pdf

const KIND_FILE: Record<string, string> = { passport: "passport", stamp: "stamp", selfie: "selfie", tm30: "tm30", other: "file" };

export async function buildDayZip(people: Person[], meta: DayMeta, extras: { photoSheet?: Blob; summary?: Blob } = {}): Promise<Blob> {
  const JSZip = await getJSZip();
  const zip = new JSZip();
  const dayFolder = meta.date.replace(/\//g, "");
  const root = zip.folder(dayFolder)?.folder(meta.jobType || "IT");
  if (!root) throw new Error("zip folder");
  for (const p of people) {
    const dir = root.folder(personFolderName(p));
    if (!dir) continue;
    const counts: Record<string, number> = {};
    for (const f of p.files) {
      const base = KIND_FILE[f.kind] ?? "file";
      counts[base] = (counts[base] ?? 0) + 1;
      const suffix = counts[base] > 1 ? `-${counts[base]}` : "";
      const ext = f.mime === "application/pdf" ? "pdf" : f.mime === "image/png" ? "png" : "jpg";
      dir.file(`${base}${suffix}.${ext}`, f.blob);
    }
    if (p.photo) dir.file("photo-white.jpg", p.photo);
    if (p.collectImage) dir.file(`collect-${p.fields.amount || "0"}.jpg`, p.collectImage);
    if (p.tm7Pdf) {
      const nm = [p.fields.lastName, p.fields.firstName].filter(Boolean).join(" ").toUpperCase() || "form";
      dir.file(`TM7-${nm}.pdf`, p.tm7Pdf);
    }
  }
  if (extras.photoSheet) root.file("photo-sheet.pdf", extras.photoSheet);
  if (extras.summary) root.file("summary.png", extras.summary);
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

// ---------- "amount to collect" image: the passport page with the amount in big red digits ----------
// Shown to the customer at the counter so the right person pays the right amount.

export async function buildCollectImage(passport: Blob, amount: number, label = ""): Promise<Blob> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const u = URL.createObjectURL(passport);
    const i = new Image();
    i.onload = () => { URL.revokeObjectURL(u); resolve(i); };
    i.onerror = () => { URL.revokeObjectURL(u); reject(new Error("image decode failed")); };
    i.src = u;
  });
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d");
  if (!g) throw new Error("no 2d context");
  g.drawImage(img, 0, 0);
  const text = amount.toLocaleString("en-US");
  const size = Math.round(Math.min(c.width * 0.22, c.height * 0.16));
  g.font = `bold ${size}px Arial, Helvetica, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = Math.max(4, size * 0.08);
  g.strokeStyle = "rgba(255,255,255,0.9)";
  g.fillStyle = "#e5102a";
  const x = c.width / 2, y = c.height * 0.22;
  g.strokeText(text, x, y);
  g.fillText(text, x, y);
  if (label) {
    const ls = Math.round(size * 0.32);
    g.font = `bold ${ls}px Arial, Helvetica, sans-serif`;
    g.lineWidth = Math.max(2, ls * 0.1);
    g.strokeText(label, x, y + size * 0.75);
    g.fillText(label, x, y + size * 0.75);
  }
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/jpeg", 0.9));
}

// ---------- hand-off to the ABC bill page (toey99.github.io/abc-bill) ----------

export const BILL_URL = "https://toey99.github.io/abc-bill/";

export function billUrl(people: Person[], amount: number, opts: { docType?: "cash_sale" | "invoice"; currency?: "THB" | "CNY"; service?: string } = {}): string {
  const payload = {
    docType: opts.docType ?? "cash_sale",
    currency: opts.currency ?? "THB",
    service: opts.service ?? "service_2",
    amount: amount || "",
    customers: people.slice(0, 5).map((p) => ({
      en: [p.fields.firstName, p.fields.lastName].filter(Boolean).join(" "),
      cn: p.fields.chineseName,
      pp: p.fields.passportNo,
    })),
  };
  const json = JSON.stringify(payload);
  const b64 = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${BILL_URL}?d=${b64}`;
}
