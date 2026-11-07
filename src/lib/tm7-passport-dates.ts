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
// month/year. Keeping the geometry in one table next to the value it
// labels makes the issue/expiry pairing explicit and unit-testable,
// instead of six loose drawText calls where two y values can be
// transposed unnoticed.
//
// Coordinates are the LOCKED production constants shared by the
// Bangkok and Nonthaburi templates (both use the same official form).

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

/** Day of month, unpadded ("5", "20") — matches the form's handwriting style. */
function day(d: Date): string {
  return d.getDate().toString();
}

function monthLong(d: Date): string {
  return MONTHS_LONG[d.getMonth()];
}

function year(d: Date): string {
  return d.getFullYear().toString();
}

/**
 * Maps the two passport dates onto their page-1 text fields.
 * A null date contributes no fields (nothing is drawn for it).
 */
export function passportDateFields(
  issueDate: Date | null,
  expiryDate: Date | null,
): Tm7TextField[] {
  const fields: Tm7TextField[] = [];

  if (issueDate) {
    // "ลงวันที่" / Date of issue — day ends the passport-number line.
    fields.push({ key: "p1.issueDay", value: day(issueDate), x: 480, y: 478 });
    fields.push({ key: "p1.issueMonth", value: monthLong(issueDate), x: 105, y: 436 });
    fields.push({ key: "p1.issueYear", value: year(issueDate), x: 205, y: 436 });
  }

  if (expiryDate) {
    // "มีอายุใช้ได้ถึงวันที่" / Valid until — day ends the issued-at line.
    fields.push({ key: "p1.expDay", value: day(expiryDate), x: 480, y: 436 });
    fields.push({ key: "p1.expMonth", value: monthLong(expiryDate), x: 105, y: 406 });
    fields.push({ key: "p1.expYear", value: year(expiryDate), x: 205, y: 406 });
  }

  return fields;
}
