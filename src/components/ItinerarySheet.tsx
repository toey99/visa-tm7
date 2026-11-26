"use client";

// =============================================================
// ItinerarySheet — customer flight itinerary picture (中文 / ไทย / EN)
// =============================================================
// One pastel card per flight, in time order, with every passenger's booking
// code / seat and whether they still have to check in at the counter.
// 中文 is what Chinese customers read, ไทย is for our own re-check, English
// is for other nationalities. Exported with html-to-image like the other
// sheets (captureNode), so everything here is inline-styled.

import { forwardRef, type CSSProperties } from "react";
import { dateKey, legKind, sortedFlights, tripWarnings, HUB, type Flight, type Trip } from "@/lib/itinerary/types";

export type ItineraryLang = "zh" | "th" | "en";

const FONT = "system-ui, 'Noto Sans Thai', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', sans-serif";
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, 'Noto Sans Mono', monospace";
const INK = "#35315C";
const SOFT = "#6E6A93";
const LINE = "#EADFF2";
const WARN_BG = "#FFE3EC";
const WARN_INK = "#B3214F";
const TONES = [
  { t: "#BFE6FF", d: "#2386C8" }, // sky
  { t: "#DDD3FF", d: "#6A4FD0" }, // lilac
  { t: "#C6F3DC", d: "#178A5B" }, // mint
  { t: "#FFF0A6", d: "#9A7400" }, // lemon
  { t: "#FFCBE0", d: "#D6397F" }, // pink
];

type Dict = {
  title: string; pax: (n: number) => string; out: string; back: string; flight: string;
  board: string; gate: string; seat: string; noDep: string;
  need: string; has: string; conflict: string; swap: (codes: string) => string;
  notes: string; nCheckIn: string; nCodes: string; nEarly: string; nMeet: string; nBag: string;
  airports: Record<string, string>; weekdays: string[]; date: (d: Date) => string;
};

const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const L: Record<ItineraryLang, Dict> = {
  zh: {
    title: "Visa Run 航班行程", pax: (n) => `共 ${n} 人`, out: "去程", back: "回程", flight: "航班",
    board: "登机", gate: "登机口", seat: "座位", noDep: "登机牌上没有起飞时间",
    need: "需到柜台办理登机", has: "已有登机牌",
    conflict: "同一航班出现了不同的起飞时间，请按较早的时间到机场，并在柜台确认。",
    swap: (c) => `注意：出发和返回不是同一个曼谷机场 (${c})。`,
    notes: "值机须知",
    nCheckIn: "标有「需到柜台办理登机」的乘客还没有登机牌：请带护照原件到航空公司柜台，报订票代码即可。",
    nCodes: "每一程的订票代码可能不同，请看清楚自己那一程的代码。",
    nEarly: "建议起飞前 2 小时到机场。",
    nMeet: "降落清莱后在 2 号门集合，再到楼外等车。",
    nBag: "只含手提行李：随身小包 1 件 + 手提行李 1 件 (56×36×23 厘米)，合计不超过 7 公斤。没有免费托运行李。",
    airports: { DMK: "廊曼机场", BKK: "素万那普机场", CEI: "清莱机场", CNX: "清迈机场", HKT: "普吉机场" },
    weekdays: ["周日", "周一", "周二", "周三", "周四", "周五", "周六"],
    date: (d) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`,
  },
  th: {
    title: "กำหนดการบิน Visa Run", pax: (n) => `รวม ${n} ท่าน`, out: "ขาไป", back: "ขากลับ", flight: "เที่ยวบิน",
    board: "ขึ้นเครื่อง", gate: "ประตู", seat: "ที่นั่ง", noDep: "ในตั๋วไม่ระบุเวลาออก",
    need: "ต้องเช็คอินที่เคาน์เตอร์", has: "มี boarding pass แล้ว",
    conflict: "ไฟลท์เดียวกันแต่เวลาออกไม่ตรงกัน ให้ไปถึงสนามบินตามเวลาที่เร็วกว่า แล้วยืนยันที่เคาน์เตอร์",
    swap: (c) => `ระวัง: ขาไปและขากลับไม่ใช่สนามบินเดียวกันในกรุงเทพฯ (${c})`,
    notes: "ข้อควรรู้ก่อนเช็คอิน",
    nCheckIn: "ผู้โดยสารที่มีป้าย “ต้องเช็คอินที่เคาน์เตอร์” ยังไม่มี boarding pass ให้นำพาสปอร์ตตัวจริงไปที่เคาน์เตอร์สายการบินและแจ้งรหัสจอง",
    nCodes: "รหัสจองของแต่ละขาอาจไม่เหมือนกัน ดูรหัสของขาที่จะบินให้ถูก",
    nEarly: "แนะนำให้ถึงสนามบินก่อนเครื่องออก 2 ชั่วโมง",
    nMeet: "ลงเครื่องที่เชียงรายแล้วนัดพบที่ประตู 2 จากนั้นออกไปรอรถหน้าอาคาร",
    nBag: "มีเฉพาะสัมภาระถือขึ้นเครื่อง: กระเป๋าใบเล็ก 1 ใบ + กระเป๋าถือขึ้นเครื่อง 1 ใบ (56×36×23 ซม.) รวมไม่เกิน 7 กก. ไม่มีน้ำหนักโหลดใต้เครื่อง",
    airports: { DMK: "ดอนเมือง", BKK: "สุวรรณภูมิ", CEI: "เชียงราย", CNX: "เชียงใหม่", HKT: "ภูเก็ต" },
    weekdays: ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"],
    date: (d) => `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear()}`,
  },
  en: {
    title: "Visa Run Flight Itinerary", pax: (n) => `${n} passenger${n === 1 ? "" : "s"}`, out: "Outbound", back: "Return", flight: "Flight",
    board: "Boarding", gate: "Gate", seat: "Seat", noDep: "Departure time not printed on the pass",
    need: "Check in at the counter", has: "Boarding pass issued",
    conflict: "The same flight shows two different departure times. Be at the airport for the earlier one and confirm at the counter.",
    swap: (c) => `Note: you leave from and return to different Bangkok airports (${c}).`,
    notes: "Check-in notes",
    nCheckIn: "Passengers marked “Check in at the counter” have no boarding pass yet: bring your original passport to the airline counter and give your booking code.",
    nCodes: "Booking codes can differ for each flight. Use the code shown for that flight.",
    nEarly: "Be at the airport 2 hours before departure.",
    nMeet: "After landing in Chiang Rai, meet at Gate 2, then wait outside the building for the car.",
    nBag: "Cabin bags only: 1 personal item + 1 carry-on (56×36×23 cm), 7 kg in total. No free checked baggage.",
    airports: { DMK: "Don Mueang", BKK: "Suvarnabhumi", CEI: "Chiang Rai", CNX: "Chiang Mai", HKT: "Phuket" },
    weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    date: (d) => `${d.getDate()} ${EN_MONTHS[d.getMonth()]} ${d.getFullYear()}`,
  },
};

function parseDate(ddmmyyyy: string): Date | null {
  const k = dateKey(ddmmyyyy);
  if (!k) return null;
  const d = new Date(Number(k.slice(0, 4)), Number(k.slice(4, 6)) - 1, Number(k.slice(6, 8)));
  return Number.isNaN(d.getTime()) ? null : d;
}

function dateLine(flights: Flight[], t: Dict, lang: ItineraryLang): string {
  const days = Array.from(new Set(flights.map((f) => dateKey(f.date)).filter(Boolean))).sort();
  if (!days.length) return "";
  const fmt = (k: string) => {
    const d = parseDate(`${k.slice(6, 8)}/${k.slice(4, 6)}/${k.slice(0, 4)}`);
    if (!d) return "";
    const wd = t.weekdays[d.getDay()];
    return lang === "zh" ? `${t.date(d)}（${wd}）` : lang === "th" ? `${wd} ${t.date(d)}` : `${wd} ${t.date(d)}`;
  };
  return days.length === 1 ? fmt(days[0]) : `${fmt(days[0])} – ${fmt(days[days.length - 1])}`;
}

function Plane({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width={34} height={34} fill={color} aria-hidden="true">
      <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" transform="rotate(90 12 12)" />
    </svg>
  );
}

const chip = (bg: string): CSSProperties => ({ background: bg, borderRadius: 9, padding: "2px 9px", fontFamily: MONO, fontWeight: 700, fontSize: 15, letterSpacing: "0.05em", whiteSpace: "nowrap" });

type Props = { trip: Trip; lang: ItineraryLang };

const ItinerarySheet = forwardRef<HTMLDivElement, Props>(function ItinerarySheet({ trip, lang }, ref) {
  const t = L[lang];
  const flights = sortedFlights(trip).filter((f) => f.riders.length > 0);
  const warn = tripWarnings(trip);
  const nameOf = (id: string) => trip.people.find((p) => p.id === id);
  const riderCount = new Set(flights.flatMap((f) => f.riders.map((r) => r.id))).size;
  const airport = (code: string, terminal: string) => `${t.airports[code] ?? code}${terminal ? ` ${terminal}` : ""}`;
  const swapCodes = Array.from(new Set(flights.flatMap((f) => [f.from, f.to]).filter((c) => c === "DMK" || c === "BKK"))).join(" / ");
  const landsAtHub = flights.some((f) => f.to === HUB);

  const notes = [
    warn.needCheckIn ? { text: t.nCheckIn, strong: true } : null,
    flights.length > 1 ? { text: t.nCodes, strong: false } : null,
    { text: t.nEarly, strong: false },
    trip.showMeetingPoint && landsAtHub ? { text: t.nMeet, strong: false } : null,
    trip.showBaggage ? { text: t.nBag, strong: false } : null,
  ].filter((n): n is { text: string; strong: boolean } => n !== null);

  return (
    <div
      ref={ref}
      style={{
        width: 540, boxSizing: "border-box", padding: "22px 18px", fontFamily: FONT, color: INK, lineHeight: 1.4,
        background: "#FFF7FB",
        backgroundImage: "radial-gradient(circle at 10% 0, #E3F4FF 0, transparent 40%), radial-gradient(circle at 95% 6%, #FFE6F1 0, transparent 36%)",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", color: "#D6397F" }}>ABC : ALLIANCE BORDER CONSULTING</div>
      <div style={{ fontSize: 29, fontWeight: 800, lineHeight: 1.2, marginTop: 4 }}>{t.title}</div>
      <div style={{ fontSize: 21, fontWeight: 800, marginTop: 2 }}>{dateLine(flights, t, lang)}</div>
      <div style={{ fontSize: 15, color: SOFT, margin: "2px 0 16px" }}>{t.pax(riderCount)}</div>

      {warn.airportSwap.length > 0 && (
        <div style={{ background: WARN_BG, color: WARN_INK, borderRadius: 16, padding: "11px 14px", fontWeight: 700, fontSize: 15, marginBottom: 14 }}>
          {t.swap(swapCodes)}
        </div>
      )}

      {flights.map((f, i) => {
        const tone = TONES[i % TONES.length];
        const kind = legKind(f);
        const leg = kind === "out" ? t.out : kind === "back" ? t.back : t.flight;
        const meta = [f.boardTime ? `${t.board} ${f.boardTime}` : "", f.gate ? `${t.gate} ${f.gate}` : ""].filter(Boolean).join("  ·  ");
        return (
          <div key={f.id} style={{ background: "#fff", border: `2px solid ${tone.t}`, borderRadius: 20, overflow: "hidden", marginBottom: 14 }}>
            <div style={{ background: tone.t, padding: "9px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 16 }}>{leg}{f.airline ? ` · ${f.airline}` : ""}</span>
              <span style={{ background: "#fff", color: tone.d, fontWeight: 800, fontSize: 20, borderRadius: 10, padding: "0 10px", whiteSpace: "nowrap" }}>{f.flightNo}</span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "14px 14px 10px" }}>
              <div>
                <div style={{ fontSize: 30, fontWeight: 800, color: tone.d, lineHeight: 1 }}>{f.from || "—"}</div>
                <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.15 }}>{f.depTime || "—"}</div>
                <div style={{ fontSize: 14, color: SOFT, fontWeight: 600 }}>{airport(f.from, f.fromTerminal)}</div>
              </div>
              <Plane color={tone.d} />
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 30, fontWeight: 800, color: tone.d, lineHeight: 1 }}>{f.to || "—"}</div>
                <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1.15 }}>{f.arrTime || "—"}</div>
                <div style={{ fontSize: 14, color: SOFT, fontWeight: 600 }}>{airport(f.to, f.toTerminal)}</div>
              </div>
            </div>

            {(meta || !f.depTime) && (
              <div style={{ padding: "0 14px 10px", fontSize: 14, fontWeight: 700, color: tone.d }}>
                {meta}{meta && !f.depTime ? "  ·  " : ""}{!f.depTime ? t.noDep : ""}
              </div>
            )}

            {f.riders.map((r) => {
              const p = nameOf(r.id);
              const en = p ? `${p.surname} ${p.given}`.trim() : r.id;
              return (
                <div key={r.id} style={{ borderTop: `1.5px dashed ${LINE}`, padding: "9px 14px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    {p?.cn ? <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.2 }}>{p.cn}</div> : null}
                    <div style={{ fontSize: p?.cn ? 14 : 18, fontWeight: 700, color: p?.cn ? SOFT : INK, letterSpacing: "0.03em" }}>{en}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {r.pnr ? <span style={chip(tone.t)}>{r.pnr}</span> : null}
                      {r.seat ? <span style={{ ...chip("#F3F0FA"), fontFamily: FONT, letterSpacing: 0, fontSize: 14 }}>{t.seat} {r.seat}</span> : null}
                    </div>
                    {r.hasBoardingPass
                      ? <span style={{ fontSize: 13, fontWeight: 700, color: "#178A5B" }}>✓ {t.has}</span>
                      : <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", background: WARN_INK, borderRadius: 999, padding: "2px 10px", whiteSpace: "nowrap" }}>{t.need}</span>}
                  </div>
                </div>
              );
            })}

            {warn.timeConflict.has(f.id) ? (
              <div style={{ borderTop: `1.5px dashed ${LINE}`, padding: "9px 14px", fontSize: 14, fontWeight: 700, color: WARN_INK, background: WARN_BG }}>
                {t.conflict}
              </div>
            ) : null}
          </div>
        );
      })}

      <div style={{ background: "#fff", border: `1.5px solid ${LINE}`, borderRadius: 20, padding: "14px 16px" }}>
        <div style={{ fontSize: 19, fontWeight: 800, marginBottom: 6 }}>{t.notes}</div>
        {notes.map((n, i) => (
          <div key={i} style={{ display: "flex", gap: 8, fontSize: 14.5, lineHeight: 1.55, marginBottom: 5, color: n.strong ? WARN_INK : INK, fontWeight: n.strong ? 700 : 400 }}>
            <span>•</span><span>{n.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
});

export default ItinerarySheet;
