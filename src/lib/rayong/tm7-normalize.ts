// =============================================================
// Server-side uppercase safety net for TM.7 data
// =============================================================
// The form already uppercases free-text input, but anything that reaches
// the generator (old clients, direct API calls, AI scan output) is
// uppercased again here. Dates, numbers, phone, postal code, title and
// the office id are left untouched.
// =============================================================

import type { Tm7FormData } from "./tm7-generator.ts";

export const UPPERCASE_FIELDS = [
  "firstName",
  "lastName",
  "nationality",
  "placeOfBirth",
  "passportNo",
  "passportIssuedAt",
  "fromCountry",
  "portOfArrival",
  "arrivedBy",
  "visaType",
  "houseNo",
  "road",
  "subDistrict",
  "district",
  "province",
  "extensionReason",
] as const satisfies readonly (keyof Tm7FormData)[];

export function uppercaseTm7Data(data: Tm7FormData): Tm7FormData {
  const out: Tm7FormData = { ...data };
  for (const key of UPPERCASE_FIELDS) {
    const v = out[key];
    if (typeof v === "string") out[key] = v.toUpperCase();
  }
  return out;
}
