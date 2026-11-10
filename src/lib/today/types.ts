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
  agent: string;
  subAgent: string;             // the main agent's own downstream agent / note — shown on their per-agent summary                // who sent the case
  pay: "collect" | "paid" | "nocollect";
  amount: string;               // THB to collect at the counter
  paidHow: "pending" | "cash" | "transfer" | "agent" | "none";  // what actually happened at the counter
  paidAmount: string;           // THB actually received by us (cash/transfer)
  agentPrice: string;           // THB to invoice the agent for this person
  cost: string;                 // THB actually paid out (fee, fine, VIP, embassy letter...)
  costNote: string;             // what the cost was made of
  note: string;
  // visa-run board only
  run: "RUN" | "RUN30";         // ordinary run, or run + 30-day extension (needs the TM.7 packet)
  car: string;                  // car id from CARS ("" = not assigned yet)
  flight: string;               // per-person flight when it differs from the day's (else "")
  landTime: string;             // HH:MM landing time when it differs from the day's
  returnBy: string;             // HH:MM "back at the airport before" when it differs from the day's
  cambodia: boolean;            // passport shows Cambodia entries/exits → 🐻 on the driver card so the Lao side is cleared correctly
  overstay: boolean;            // passport shows an overstay (ticked by hand from the stamps) → 🐢 on the driver card; fine 2,000 + 500/day
  overstayDays: string;         // days over, typed by hand (shown after the 🐢)
  report: boolean;              // include in the evening "visa expiry" infographic sent back to the factory / agent
  newUntil: string;             // DD/MM/YYYY override of the computed post-run expiry (when the officer stamped something else)
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
  cancelled?: boolean;          // no-show: kept for the record, excluded from everything
  arrived?: boolean;            // checked in at the counter (green tick on the summary)
  movedTo?: string;             // DD/MM/YYYY — rescheduled to another day (ghost kept here for the day's record)
  createdAt: number;
  updatedAt?: string;           // ISO — set on every save; the server keeps the newer record when two devices disagree
};

export type DayMeta = {
  date: string;                 // DD/MM/YYYY (appointment / form date)
  office: OfficeId;             // which immigration office today's cases go to
  jobType: string;              // folder label, e.g. IT
  formLocation: string;         // BANGKOK
  extensionDays: string;        // "30"
  extensionReason: string;      // TOURISM
  // visa-run board only
  slot: string;                 // RUN_SLOTS id — morning / noon / afternoon / evening
  flight: string;               // default flight for the day, e.g. DD102
  landTime: string;             // HH:MM
  returnBy: string;             // HH:MM — must be back at the airport before this
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
  visaType: "EXEMPTION (PORPOR 30)",
  houseNo: "",
  road: "",
  subDistrict: "",
  district: "",
  province: "",
  postalCode: "",
  phone: "",
  agent: "",
  subAgent: "",
  pay: "collect",
  amount: "",
  paidHow: "pending",
  paidAmount: "",
  agentPrice: "",
  cost: "",
  costNote: "",
  note: "",
  run: "RUN",
  car: "",
  flight: "",
  landTime: "",
  returnBy: "",
  cambodia: false,
  overstay: false,
  overstayDays: "",
  report: false,
  newUntil: "",
};

export const DEFAULT_META: DayMeta = {
  date: "",
  office: DEFAULT_OFFICE,
  jobType: OFFICES[DEFAULT_OFFICE].short,
  formLocation: OFFICES[DEFAULT_OFFICE].formLocation,
  extensionDays: "30",
  extensionReason: "TOURISM",
  slot: "morning",
  flight: "",
  landTime: "",
  returnBy: "",
};

// Visa-run board defaults: customers are driven to the Chiang Saen border.
export const DEFAULT_META_RUN: DayMeta = {
  ...DEFAULT_META,
  office: "CHIANG_SAEN",
  jobType: "RUN",
  formLocation: OFFICES.CHIANG_SAEN.formLocation,
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

// After a visa run the customer re-enters on the run day and gets a fresh
// stay from the visa type (default exemption 30 days, arrival day counts as
// day 1); "run + 30 days" adds the extension on top of that.
export function runExpiry(runDate: string, visaType: string, run: "RUN" | "RUN30", override = ""): Date | null {
  const o = parseDdmmyyyy(override);
  if (o) return o;
  const d = parseDdmmyyyy(runDate);
  if (!d) return null;
  const days = allowedDaysFromVisaType(visaType) ?? 30;
  const out = new Date(d);
  out.setDate(out.getDate() + days - 1 + (run === "RUN30" ? 30 : 0));
  return out;
}
// After a 30-day (or N-day) extension at the office: the stamped "admitted
// until" (or arrival + visa days − 1) plus the extension.
export function extensionExpiry(arrivalDate: string, admittedUntil: string, visaType: string, extensionDays: string, override = ""): Date | null {
  const o = parseDdmmyyyy(override);
  if (o) return o;
  const until = effectiveAdmittedUntil(arrivalDate, admittedUntil, visaType);
  if (!until) return null;
  const out = new Date(until.date);
  out.setDate(out.getDate() + (Number(extensionDays) || 30));
  return out;
}
export const fmtDdmmyyyy = (d: Date) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

// Folder name the user keeps on disk: "01 LU LIANG" (surname first).
export function personFolderName(p: Person): string {
  const nn = String(p.order).padStart(2, "0");
  const name = [p.fields.lastName, p.fields.firstName].filter(Boolean).join(" ").replace(/[\\/:*?"<>|]/g, "").trim();
  return `${nn} ${name || "UNKNOWN"}`;
}

// Days of stay a visa type grants on entry (day of arrival counts as day 1),
// read from the free-text visa type: "PORPOR 30" → 30, "VOA" → 15, "TR" → 60.
export function allowedDaysFromVisaType(visaType: string): number | null {
  const v = (visaType || "").toUpperCase();
  const m = v.match(/(\d{2,3})\s*(?:DAYS?)?/);
  if (m) return Number(m[1]);
  if (/VOA|ON ARRIVAL/.test(v)) return 15;
  if (/\bTR\b|TOURIST/.test(v)) return 60;
  return null;
}

// "Admitted until" date: the blue stamp if read, else arrival + allowed days − 1.
export function effectiveAdmittedUntil(arrivalDate: string, admittedUntil: string, visaType: string): { date: Date; source: "stamp" | "visa" } | null {
  const stamped = parseDdmmyyyy(admittedUntil);
  if (stamped) return { date: stamped, source: "stamp" };
  const arr = parseDdmmyyyy(arrivalDate);
  const days = allowedDaysFromVisaType(visaType);
  if (!arr || !days) return null;
  const d = new Date(arr);
  d.setDate(d.getDate() + days - 1);
  return { date: d, source: "visa" };
}

// ---------- working days / holidays ----------
// Immigration follows government holidays. Default list = Thai government
// holidays for 2026 (editable in the ⚙ panel; stored in localStorage as
// DD/MM/YYYY per line). A visa that expires on a weekend or holiday can be
// extended on the NEXT WORKING DAY with no fine; filing any later than that
// is fined for every day after expiry, weekend included.
export const DEFAULT_HOLIDAYS = [
  "01/01/2026", "02/01/2026", "03/03/2026", "06/04/2026", "13/04/2026", "14/04/2026", "15/04/2026",
  "04/05/2026", "01/06/2026", "03/06/2026", "28/07/2026", "29/07/2026", "30/07/2026", "12/08/2026",
  "13/10/2026", "23/10/2026", "07/12/2026", "10/12/2026", "31/12/2026",
];
const HOLIDAY_KEY = "tm7-holidays";
export function loadHolidays(): string[] {
  try {
    const raw = localStorage.getItem(HOLIDAY_KEY);
    if (raw) return raw.split(/\r?\n|,/).map((x) => x.trim()).filter(Boolean);
  } catch {}
  return [...DEFAULT_HOLIDAYS];
}
export function saveHolidays(list: string[]) {
  try { localStorage.setItem(HOLIDAY_KEY, list.join("\n")); } catch {}
}
export function isWorkingDay(d: Date, holidays: string[]): boolean {
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return false;
  return !holidays.includes(fmtDdmmyyyy(d));
}
export function nextWorkingDay(d: Date, holidays: string[]): Date {
  const n = new Date(d);
  do { n.setDate(n.getDate() + 1); } while (!isWorkingDay(n, holidays));
  return n;
}

export type OverstayInfo = {
  days: number;            // fined days (0 when within the grace rule)
  fine: number;
  until: string;           // DD/MM/YYYY admitted-until used
  source: "stamp" | "visa";
  graceUntil?: string;     // next working day after a weekend/holiday expiry (no fine if filed by then)
  lateDays?: number;       // calendar days past "until" (shown even when fine is 0 under grace)
};

// grace=false for the visa-run board: the border is open every day, so an
// expiry on a weekend/holiday gets no next-working-day allowance — every day
// after "admitted until" is fined.
export function overstayInfo(arrivalDate: string, admittedUntil: string, visaType: string, appointmentDate: string, holidays: string[] = DEFAULT_HOLIDAYS, grace = true): OverstayInfo | null {
  const until = effectiveAdmittedUntil(arrivalDate, admittedUntil, visaType);
  const appt = parseDdmmyyyy(appointmentDate);
  if (!until || !appt) return null;
  const late = daysBetween(until.date, appt);
  const base = { until: fmtDdmmyyyy(until.date), source: until.source, lateDays: Math.max(0, late) };
  if (late <= 0) return { ...base, days: 0, fine: 0 };
  if (grace && !isWorkingDay(until.date, holidays)) {
    const grace = nextWorkingDay(until.date, holidays);
    const graceStr = fmtDdmmyyyy(grace);
    if (daysBetween(grace, appt) <= 0) return { ...base, days: 0, fine: 0, graceUntil: graceStr };
    return { ...base, days: late, fine: late * OVERSTAY_FINE_PER_DAY, graceUntil: graceStr };
  }
  return { ...base, days: late, fine: late * OVERSTAY_FINE_PER_DAY };
}
