// =============================================================
// Link library ("ลิงก์ส่งลูกค้า")
// =============================================================
// Every page we send to customers lives in its own small site; this is the one
// list of them — grouped by service, with a name per language for the message
// that goes with the link. Entries marked `todo` are pages that do not exist
// yet (services still without something to send). One file, kept for good.
import { blobGetJson, blobPut } from "@/lib/blob";

export type LinkItem = {
  id: string;
  group: string;            // service heading
  title: string;            // Thai name
  titleZh?: string;
  titleEn?: string;
  url: string;              // "" while todo
  langs?: string;           // languages the page itself offers, e.g. "TH/EN/CN"
  note?: string;            // for us only
  pinned?: boolean;
  todo?: boolean;           // page not made yet
  updatedAt?: string;
};

export const LINK_GROUPS = ["ต่อวีซ่า 30 วัน", "Visa Run", "Non-B / ทำงาน", "เกษียณ", "ครอบครัว", "DTV", "รายงานตัว / แจ้งที่พัก", "อื่น ๆ", "เครื่องมือของเรา (ไม่ส่งลูกค้า)"] as const;

const G = "https://toey99.github.io";
const live = (id: string, group: string, title: string, titleZh: string, titleEn: string, path: string, langs = "", extra: Partial<LinkItem> = {}): LinkItem => ({ id, group, title, titleZh, titleEn, url: `${G}/${path}`, langs, ...extra });
const todo = (id: string, group: string, title: string, titleZh: string, titleEn: string, note = ""): LinkItem => ({ id, group, title, titleZh, titleEn, url: "", todo: true, note });

/** First contents: the pages that are online today, and the services that still have nothing to send. */
export const DEFAULT_LINKS: LinkItem[] = [
  live("ext-service", "ต่อวีซ่า 30 วัน", "บริการต่อวีซ่า 30 วัน", "签证延期30天服务", "30-day visa extension service", "extendvisa2nd/", "", { pinned: true }),
  live("it-square", "ต่อวีซ่า 30 วัน", "คู่มือเดินทาง IT Square หลักสี่ (K Counter ชั้น 3)", "IT Square 交通指南（3楼 K Counter）", "How to get to IT Square (K Counter, 3rd floor)", "it-square-guide/", "TH/EN/CN", { pinned: true }),
  live("gov-complex", "ต่อวีซ่า 30 วัน", "คู่มือเดินทางศูนย์ราชการ แจ้งวัฒนะ", "政府综合大楼（Chaeng Watthana）交通指南", "How to get to the Government Complex (Chaeng Watthana)", "gov-complex-guide/", "TH/EN/CN"),
  live("visarun", "Visa Run", "Visa Run วันเดียวจบ เชียงราย", "清莱一日往返 Visa Run", "One-day visa run via Chiang Rai", "visarun/", "TH/EN/CN", { pinned: true }),
  live("visarun-trips", "Visa Run", "สรุปตั๋วและกำหนดการเดินทาง Visa Run", "Visa Run 机票与行程", "Visa run flight itinerary", "visarun-trips/", "", { note: "หน้ารวม — ลิงก์ของแต่ละทริปอยู่ข้างใน" }),
  live("nonb-index", "Non-B / ทำงาน", "รายการเอกสารวีซ่า Non-B (หน้ารวม)", "Non-B 签证文件清单（总览）", "Non-B visa document checklists", "visanonb-checklist/", "TH/EN/CN"),
  live("nonb-change", "Non-B / ทำงาน", "เอกสารเปลี่ยนประเภทวีซ่าเป็น Non-B (ยื่นในไทย)", "在泰国境内转换 Non-B 签证所需文件", "Documents to change to a Non-B visa inside Thailand", "visanonb-checklist/nonb-doclist.html", "TH/EN/CN", { pinned: true }),
  live("nonb-embassy", "Non-B / ทำงาน", "เอกสารขอวีซ่า Non-B จากสถานทูตไทยในต่างประเทศ (e-Visa)", "在泰国驻外使馆申请 Non-B 签证所需文件（e-Visa）", "Documents for a Non-B visa from a Thai embassy abroad (e-Visa)", "visanonb-checklist/nonb-embassy.html", "TH/EN/CN"),
  live("wp32", "Non-B / ทำงาน", "เอกสารขออนุญาตทำงานแทนคนต่างด้าว (บต.32 / WP.32)", "代外籍员工申请工作许可所需文件（WP.32）", "Documents for work-permit pre-approval (WP.32)", "visanonb-checklist/wp32-doclist.html", "TH/EN/CN"),
  live("wp-types", "Non-B / ทำงาน", "ประเภทใบอนุญาตทำงาน 2026", "2026 工作许可类别", "Work permit categories 2026", "work-permit-selector/", "", { note: "ตรวจว่ายังใช้ส่งลูกค้าอยู่ไหม" }),
  live("retire", "เกษียณ", "บริการวีซ่าเกษียณ (Retirement Visa)", "养老签证服务", "Retirement visa service", "retirementvisa/", "", { pinned: true }),
  live("thaiwife", "ครอบครัว", "บริการวีซ่าคู่สมรสไทย (Thai Wife Visa)", "泰国配偶签证服务", "Thai spouse visa service", "thaiwife/"),
  live("dtv-en", "DTV", "เช็กลิสต์เอกสาร DTV (อังกฤษ)", "DTV 签证申请清单（英文）", "DTV visa application checklist", "dtvchecklist/", "EN"),
  live("dtv-cn", "DTV", "รายการเอกสารวีซ่า DTV (จีน / ไทย)", "申请 DTV 签证所需文件清单", "DTV visa document list (Chinese / Thai)", "dtvdocumentlist/", "CN/TH"),
  live("true-cert", "อื่น ๆ", "วิธีขอหนังสือรับรองสิทธิ์เจ้าของเบอร์โทรศัพท์ True", "如何申请 True 手机号码机主证明", "How to get a True phone-number ownership certificate", "true-certificate-guide/"),
  live("tool-bill", "เครื่องมือของเรา (ไม่ส่งลูกค้า)", "โปรแกรมบิล ABC (ใบแจ้งหนี้ / บิลเงินสด)", "", "", "abc-bill/"),
  live("tool-help", "เครื่องมือของเรา (ไม่ส่งลูกค้า)", "HelpMePls — ชุดเครื่องมือช่วยงาน (แก้ตั๋ว, แปลบัตร, ใบจองโรงแรม, บิล 2 สกุลเงิน)", "", "", "helpmepls/"),
  live("tool-expiry", "เครื่องมือของเรา (ไม่ส่งลูกค้า)", "ระบบแจ้งวันหมดอายุวีซ่า (พิมพ์สลิป)", "", "", "visa-expiry-printer/"),
  // ---- services with nothing to send yet ----
  todo("todo-d90", "รายงานตัว / แจ้งที่พัก", "บริการรายงานตัว 90 วัน — ต้องเตรียมอะไร ส่งอะไรมา", "90天报到服务：需要准备什么", "90-day report service — what to send us"),
  todo("todo-tm30", "รายงานตัว / แจ้งที่พัก", "แจ้งที่พัก ตม.30 — เอกสารที่เจ้าบ้านต้องเตรียม", "TM.30 住宿申报：房东需准备的文件", "TM.30 residence notification — what the landlord prepares"),
  todo("todo-ext-docs", "ต่อวีซ่า 30 วัน", "ต่อวีซ่า 30 วัน — ต้องส่งเอกสารอะไร ถ่ายรูปแบบไหน", "延期30天：需要发送哪些资料、照片要求", "30-day extension — what to send and photo rules", "ลูกค้าถามบ่อย: พาสปอร์ต, ตราเข้า, เซลฟี, ที่พัก"),
  todo("todo-guide-other", "ต่อวีซ่า 30 วัน", "คู่มือเดินทาง ตม.นนทบุรี / ระยอง / VFS พัทยา", "暖武里 / 罗勇移民局、芭提雅 VFS 交通指南", "How to get to Nonthaburi / Rayong immigration and VFS Pattaya", "ตอนนี้มีแค่ IT Square กับศูนย์ราชการ"),
  todo("todo-overstay", "ต่อวีซ่า 30 วัน", "Overstay — ค่าปรับและขั้นตอน", "逾期停留：罚款与办理流程", "Overstay — fines and what happens"),
  todo("todo-reentry", "อื่น ๆ", "Re-entry Permit — ใครต้องทำ ทำเมื่อไร", "回头签（Re-entry）：谁需要办、何时办", "Re-entry permit — who needs it and when"),
  todo("todo-nonb-1y", "Non-B / ทำงาน", "ต่ออายุวีซ่า Non-B 1 ปี — รายการเอกสาร", "Non-B 签证一年延期所需文件", "Non-B one-year extension — document list"),
  todo("todo-nono-child", "ครอบครัว", "Non-O ติดตามบุตรเรียนในไทย / ผู้ปกครอง — รายการเอกสาร", "陪读签证（Non-O）所需文件", "Non-O guardian of a student — document list"),
  todo("todo-non-ed", "อื่น ๆ", "Non-ED วีซ่านักเรียน — รายการเอกสาร", "Non-ED 学生签证所需文件", "Non-ED student visa — document list"),
  todo("todo-dtv-sale", "DTV", "บริการวีซ่า DTV (หน้าแนะนำบริการ)", "DTV 签证服务介绍", "DTV visa service", "ตอนนี้มีแค่เช็กลิสต์เอกสาร ยังไม่มีหน้าแนะนำบริการ"),
  todo("todo-translate", "อื่น ๆ", "บริการแปลเอกสารพร้อมรับรองคำแปล", "文件翻译及翻译认证服务", "Certified document translation"),
];

const PATH = "links/library.json";
type LibFile = { items: LinkItem[]; savedAt: string };

/** The saved library, or the first contents while nothing has been saved yet. */
export async function listLinks(): Promise<LinkItem[]> {
  const f = await blobGetJson<LibFile>(PATH);
  return f?.items ?? DEFAULT_LINKS;
}
async function write(items: LinkItem[]): Promise<void> {
  await blobPut(PATH, JSON.stringify({ items, savedAt: new Date().toISOString() } satisfies LibFile), "application/json");
}
export async function saveLink(item: LinkItem): Promise<LinkItem> {
  const items = [...(await listLinks())];
  const next = { ...item, updatedAt: new Date().toISOString() };
  const i = items.findIndex((x) => x.id === item.id);
  if (i >= 0) items[i] = next; else items.push(next);
  await write(items);
  return next;
}
export async function removeLink(id: string): Promise<void> {
  await write((await listLinks()).filter((x) => x.id !== id));
}
