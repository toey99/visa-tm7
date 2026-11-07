// =============================================================
// TM.7 page 1 — passport "Date of issue" / "Valid until" fields
// =============================================================
// The official form wraps each passport date across two printed
// lines, and that wrap is what makes the DAY boxes easy to mix up:
//
//   y 478  ... Passport No. [x 330] ........ Date of issue [x 480] ← ISSUE day
//   y 436  Month [x 105] Year [x 205] Issued at [x 300]
//                              ... Valid until Date [x 480] ← EXPIRY day
//   y 406  Month [x 105] Year [x 205] Type of Visa [x 350]
//
// So each date's DAY sits at the END of the line ABOVE its own
// month/year. Verified against the Nonthaburi template's text layer:
// "ลงวันที่ / Date of issue" ends the Passport No. row (dots at
// y≈465), "มีอายุใช้ได้ถึงวันที่ / Valid until Date" ends the Issued-at
// row (dots at y≈430). Keeping the geometry in one table next to the
// value it labels makes the issue/expiry pairing explicit and
// unit-testable, instead of six loose drawText calls where two y
// values can be transposed unnoticed.

export type Tm7TextField = {
  /** Stable field key used by the female-offset system. */
  key: string;
  value: string;
  x: number;
  y: number;
};

const MONTHS_LONG = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

type DateParts = { day: string; month: string; year: string };

/**
 * Splits an ISO "YYYY-MM-DD" string (an optional time suffix is
 * ignored) into printable parts WITHOUT going through Date, so the
 * output never shifts by a day with the server's timezone.
 * Returns null for a missing or invalid date.
 */
export function splitIsoDate(iso: string | undefined | null): DateParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return null;
  return {
    day: m[3], // already zero-padded: "05", "20"
    month: MONTHS_LONG[month - 1],
    year: m[1],
  };
}

/**
 * Maps the two passport dates (ISO "YYYY-MM-DD") onto their page-1
 * text fields. A missing/invalid date contributes no fields.
 */
export function passportDateFields(
  issueIso: string | undefined | null,
  expiryIso: string | undefined | null,
): Tm7TextField[] {
  const fields: Tm7TextField[] = [];
  const issue = splitIsoDate(issueIso);
  const expiry = splitIsoDate(expiryIso);

  if (issue) {
    // "ลงวันที่" / Date of issue — day ends the passport-number line.
    fields.push({ key: "p1.issueDay", value: issue.day, x: 480, y: 478 });
    fields.push({ key: "p1.issueMonth", value: issue.month, x: 105, y: 436 });
    fields.push({ key: "p1.issueYear", value: issue.year, x: 205, y: 436 });
  }

  if (expiry) {
    // "มีอายุใช้ได้ถึงวันที่" / Valid until — day ends the issued-at line.
    fields.push({ key: "p1.expDay", value: expiry.day, x: 480, y: 436 });
    fields.push({ key: "p1.expMonth", value: expiry.month, x: 105, y: 406 });
    fields.push({ key: "p1.expYear", value: expiry.year, x: 205, y: 406 });
  }

  return fields;
}
