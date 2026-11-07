// Shared types for the /today daily board.

import type { DocType } from "@/app/actions/analyzeDoc";
import { DEFAULT_OFFICE, OFFICES, type OfficeId } from "@/lib/offices";

export type { DocType };

export type DocFile = {
  id: string;
  kind: DocType;          // what the AI (or the user) says this file is
  name: string;           // original filename
  mime: string;           // image/jpeg | application/pdf
  blob: Blob;             // downscaled image, or the (possibly compressed) PDF
  status: "queued" | "analyzing" | "done" | "error";
  error?: string;
  photoBox?: string;      // passport only: where the holder's photo is ("ymin,xmin,ymax,xmax" /1000)
};

export type PersonFields = {
  title: "MR." | "MRS." | "MISS";
  firstName: string;
  lastName: string;
  chineseName: string;
  nationality: string;
  dateOfBirth: string;          // DD/MM/YYYY
  placeOfBirth: string;
  passportNo: string;
  passportIssueDate: string;
  passportExpiryDate: string;
  passportIssuedAt: string;
  arrivalDate: string;          // DD/MM/YYYY
  admittedUntil: string;        // DD/MM/YYYY (blue stamp)
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
  // bookkeeping for the day
  agent: string;                // who sent the case
  pay: "collect" | "paid" | "nocollect";
  amount: string;               // THB to collect
  note: string;
};

export type Person = {
  id: string;
  order: number;
  fields: PersonFields;
  files: DocFile[];
  tm7Pdf?: Blob;                // generated TM.7 packet (with TM.30 appended)
  aiPhoto?: Blob;               // studio-style output from the image model
  photo?: Blob;                 // final framed 4×5.33 cm JPEG (600 dpi)
  crop?: { zoom: number; dx: number; dy: number };
  photoMode?: "selfie" | "passport";
  cloth?: string;               // clothing used in passport mode
  photoExtra?: string;          // per-person extra instruction for the image model
  collectImage?: Blob;          // passport page stamped with the amount to collect
  createdAt: number;
};

export type DayMeta = {
  date: string;                 // DD/MM/YYYY (appointment / form date)
  office: OfficeId;             // which immigration office today's cases go to
  jobType: string;              // folder label, e.g. IT
  formLocation: string;         // BANGKOK
  extensionDays: string;        // "30"
  extensionReason: string;      // TOURISM
};

export const EMPTY_FIELDS: PersonFields = {
  title: "MR.",
  firstName: "",
  lastName: "",
  chineseName: "",
  nationality: "CHINESE",
  dateOfBirth: "",
  placeOfBirth: "",
  passportNo: "",
  passportIssueDate: "",
  passportExpiryDate: "",
  passportIssuedAt: "",
  arrivalDate: "",
  admittedUntil: "",
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
  agent: "",
  pay: "collect",
  amount: "",
  note: "",
};

export const DEFAULT_META: DayMeta = {
  date: "",
  office: DEFAULT_OFFICE,
  jobType: OFFICES[DEFAULT_OFFICE].short,
  formLocation: OFFICES[DEFAULT_OFFICE].formLocation,
  extensionDays: "30",
  extensionReason: "TOURISM",
};

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function todayDdmmyyyy(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

// "DD/MM/YYYY" → "YYYY-MM-DD" or undefined when empty/invalid.
export function ddmmyyyyToIso(s: string): string | undefined {
  const m = (s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return undefined;
  const [, dd, mm, yyyy] = m;
  const day = Number(dd), month = Number(mm), year = Number(yyyy);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return undefined;
  return `${yyyy}-${mm}-${dd}`;
}

export function parseDdmmyyyy(s: string): Date | null {
  const iso = ddmmyyyyToIso(s);
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// Whole days from a to b (b − a), negative when b is earlier.
export function daysBetween(a: Date, b: Date): number {
  const ms = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  return Math.round(ms / 86400000);
}

export const OVERSTAY_FINE_PER_DAY = 500;

// Folder name the user keeps on disk: "01 LU LIANG" (surname first).
export function personFolderName(p: Person): string {
  const nn = String(p.order).padStart(2, "0");
  const name = [p.fields.lastName, p.fields.firstName].filter(Boolean).join(" ").replace(/[\\/:*?"<>|]/g, "").trim();
  return `${nn} ${name || "UNKNOWN"}`;
}
