// =============================================================
// Page 3 field coordinates — STM.2 (English-only edition)
// =============================================================
// Template: public/templates/tm7-rayong.pdf, page 3 (index 2).
// Page 3 is a scanned image (595.44 × 842.40 pt) with NO text layer,
// so these positions were measured from the scan's pixels, not from
// extracted text. Tune them visually with:
//
//   npm run preview      → preview-rayong.pdf (page 3 + coordinate grid)
//
// Units: PDF points, origin bottom-left. For text fields (x, y) is the
// left end of the text baseline; `maxX` is where the dotted leader for
// that box ends, so text running past it overflows the box.
//
// Used by src/lib/tm7-generator.ts (the production generator)
//
// Page 3 has no "สถานที่ยื่นคำร้อง / Location" box (the old 5-page
// layout had a second one on page 4, STM.9, which no longer exists), so
// the office location is printed only on page 1.
// =============================================================

export type Title = "MR." | "MRS." | "MISS";

export type Page3TextField = {
  x: number;
  y: number;
  size: number;
  /** Right end of the box's dotted leader. */
  maxX: number;
};

export type StrikeSegment = { x1: number; x2: number; y: number };

export const PAGE3_INDEX = 2;
export const PAGE3_SIZE = { width: 595.44, height: 842.4 } as const;

export const PAGE3_FIELDS = {
  // "Date ………" — top right, above "To: Commissioner…". Leader x 440–534.
  printDate: { x: 442, y: 689, size: 11, maxX: 534 },

  // "I, (Mr./Mrs./Miss ………," — first half of the name leader (x 236–373).
  lastName: { x: 240, y: 636, size: 11, maxX: 373 },

  // Same line, second half of the name leader (x 377–533).
  firstName: { x: 385, y: 636, size: 11, maxX: 533 },

  // "aged ……… years," — leader x 117–173.
  age: { x: 125, y: 616, size: 12, maxX: 173 },

  // "of ……… nationality," — leader x 224–330.
  nationality: { x: 230, y: 616, size: 12, maxX: 330 },

  // "…stay permit in the Kingdom on the grounds of ………" — leader x 313–533.
  extensionReason: { x: 318, y: 596, size: 12, maxX: 533 },
} as const satisfies Record<string, Page3TextField>;

export type Page3FieldKey = keyof typeof PAGE3_FIELDS;

// Title strike-through on "I, (Mr./Mrs./Miss" — strike the titles that
// do NOT apply. Glyph extents on the scan: "Mr./" x 173–192,
// "Mrs./" x 192–214, "Miss" x 216–234; x-height middle y ≈ 636.5.
const TITLE_Y = 636.5;
export const PAGE3_TITLE_STRIKES: Readonly<Record<Title, readonly StrikeSegment[]>> = {
  "MR.": [{ x1: 192, x2: 234, y: TITLE_Y }], // strike "Mrs./Miss"
  "MRS.": [
    { x1: 173, x2: 191, y: TITLE_Y }, // strike "Mr./"
    { x1: 216, x2: 234, y: TITLE_Y }, // strike "Miss"
  ],
  MISS: [{ x1: 173, x2: 213, y: TITLE_Y }], // strike "Mr./Mrs./"
};

export const PAGE3_LINE_THICKNESS = 1.5;

export type Page3Values = Record<Page3FieldKey, string>;

export type Page3TextOp = { key: Page3FieldKey; value: string } & Page3TextField;

/** Text draw operations for page 3; empty values are skipped. */
export function page3TextOps(values: Page3Values): Page3TextOp[] {
  return (Object.keys(PAGE3_FIELDS) as Page3FieldKey[])
    .filter((key) => values[key])
    .map((key) => ({ key, value: values[key], ...PAGE3_FIELDS[key] }));
}
