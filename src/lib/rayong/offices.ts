// =============================================================
// Immigration offices served by this app
// =============================================================
// The ONLY source of the "Form Location / สถานที่ยื่นคำร้อง" text printed
// on the TM.7. The form sends an office id; the server maps it to the
// printed text here. There is deliberately no free-text or default
// location anywhere else.
// =============================================================

export const OFFICES = {
  RAYONG: { label: "Rayong", thai: "ระยอง", formLocation: "RAYONG" },
  CHIANG_SAEN: { label: "Chiang Saen", thai: "เชียงแสน", formLocation: "CHIANG SAEN" },
} as const;

export type OfficeId = keyof typeof OFFICES;

export const OFFICE_IDS = Object.keys(OFFICES) as OfficeId[];

export const DEFAULT_OFFICE: OfficeId = "RAYONG";

export function isOfficeId(v: unknown): v is OfficeId {
  return typeof v === "string" && Object.hasOwn(OFFICES, v);
}

/** Text printed in the form-location box for an office. */
export function officeFormLocation(id: OfficeId): string {
  if (!isOfficeId(id)) throw new Error(`Unknown office: ${String(id)}`);
  return OFFICES[id].formLocation;
}
