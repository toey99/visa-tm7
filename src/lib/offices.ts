// =============================================================
// Immigration offices served by tm7.toyka.net
// =============================================================
// One entry per office: which TM.7 generator produces its packet, what
// is printed in the form-location box, the folder label the user keeps
// on disk, and the colour of the daily one-page summary (each office
// gets its own so the right sheet is recognisable at a glance).

export const OFFICES = {
  BANGKOK: {
    label: "กรุงเทพ (IT Square)",
    short: "IT",
    formLocation: "BANGKOK",
    generator: "bangkok",
    summaryTitle: "IT SQUARE ชั้น 3",
    emoji: "🏙️",
    subtitle: "IT Square ชั้น 3 · แจ้งวัฒนะ",
    summaryBg: "linear-gradient(135deg,#e9ecef,#f8f9fa 40%,#dfe3e8)",
    summaryAccent: "#495057",
    pages: "TM.7 5 หน้า + TM30",
  },
  NONTHABURI: {
    label: "นนทบุรี",
    short: "NON",
    formLocation: "NONTHABURI",
    generator: "nonthaburi",
    summaryTitle: "ตม.นนทบุรี",
    emoji: "🏛️",
    subtitle: "ตม.จังหวัดนนทบุรี",
    summaryBg: "linear-gradient(135deg,#cfe3ff,#eaf3ff 40%,#bcd6ff)",
    summaryAccent: "#1d4ed8",
    pages: "TM.7 5 หน้า (นนท์) + TM30",
  },
  RAYONG: {
    label: "ระยอง",
    short: "RAY",
    formLocation: "RAYONG",
    generator: "rayong",
    summaryTitle: "ตม.ระยอง",
    emoji: "🌊",
    subtitle: "ตม.จังหวัดระยอง",
    summaryBg: "linear-gradient(135deg,#d1f2dc,#edfbf1 40%,#b9ecc9)",
    summaryAccent: "#15803d",
    pages: "TM.7 2 หน้า + STM.2 + TM30",
  },
  CHIANG_SAEN: {
    label: "เชียงแสน",
    short: "CSN",
    formLocation: "CHIANG SAEN",
    generator: "rayong",
    summaryTitle: "ตม.เชียงแสน",
    emoji: "⛰️",
    subtitle: "ด่าน ตม.เชียงแสน",
    summaryBg: "linear-gradient(135deg,#ffe3c4,#fff4e6 40%,#ffd3a3)",
    summaryAccent: "#c2410c",
    pages: "TM.7 2 หน้า + STM.2 + STM.9 + TM30",
  },
} as const;

export type OfficeId = keyof typeof OFFICES;
export const OFFICE_IDS = Object.keys(OFFICES) as OfficeId[];
export const DEFAULT_OFFICE: OfficeId = "BANGKOK";

export function isOfficeId(v: unknown): v is OfficeId {
  return typeof v === "string" && Object.hasOwn(OFFICES, v);
}
