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
    summaryBg: "linear-gradient(135deg,#fbcfe8,#fdf2f8 40%,#f9a8d4)",
    summaryAccent: "#be185d",
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
  VFS_BANGKOK: {
    label: "VFS ศูนย์ราชการ (ตึก B)",
    short: "VFS",
    formLocation: "BANGKOK",
    generator: "none",
    summaryTitle: "VFS ศูนย์ราชการ ตึก B",
    emoji: "🏢",
    subtitle: "VFS Global · ศูนย์ราชการแจ้งวัฒนะ อาคาร B",
    summaryBg: "linear-gradient(135deg,#e9d5ff,#f5ecff 40%,#d8b4fe)",
    summaryAccent: "#7e22ce",
    pages: "ไม่ต้องทำ TM.7 (ยื่นผ่าน VFS)",
  },
  VFS_PATTAYA: {
    label: "VFS พัทยา",
    short: "VFSPTY",
    formLocation: "PATTAYA",
    generator: "none",
    summaryTitle: "VFS พัทยา",
    emoji: "🏖️",
    subtitle: "VFS Global · พัทยา",
    summaryBg: "linear-gradient(135deg,#ccfbf1,#ecfefb 40%,#99f6e4)",
    summaryAccent: "#0f766e",
    pages: "ไม่ต้องทำ TM.7 (ยื่นผ่าน VFS)",
  },
} as const;

export type OfficeId = keyof typeof OFFICES;
export const OFFICE_IDS = Object.keys(OFFICES) as OfficeId[];
export const DEFAULT_OFFICE: OfficeId = "BANGKOK";

export function isOfficeId(v: unknown): v is OfficeId {
  return typeof v === "string" && Object.hasOwn(OFFICES, v);
}
