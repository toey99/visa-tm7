"use client";

// =============================================================
// CarCard — one seating card per car for the visa-run board
// =============================================================
// Sent to the customers riding that car: their photos + names (EN / 中文),
// the date (TH / 中文 with the time slot), the flight + landing time,
// the "be back at the airport before …" box and the car photo + plate.
// Styled like the daily summary (header band in the car's colour, white
// panels, slogan footer). Rendered on screen and exported with
// html-to-image.

import { forwardRef, useEffect, useState } from "react";
import type { Car } from "@/lib/visarun/cars";
import { MEETING_POINT, RUN_SLOTS } from "@/lib/visarun/cars";
import type { DayMeta, Person } from "@/lib/today/types";
import { cropPassportPhoto } from "@/lib/today/photoTools";

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const FONT = "system-ui, 'Noto Sans Thai', 'Noto Sans SC', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";
const PANEL: React.CSSProperties = { background: "rgba(255,255,255,.92)", borderRadius: 16, boxShadow: "0 2px 10px rgba(0,0,0,.06)" };
const ZH_NUM = ["", "1", "2", "3", "4"];

const CarCard = forwardRef<HTMLDivElement, { car: Car; people: Person[]; meta: DayMeta }>(function CarCard({ car, people, meta }, ref) {
  const [dd, mm] = meta.date.split("/");
  const slot = RUN_SLOTS.find((s) => s.id === (meta.slot || "morning")) ?? RUN_SLOTS[0];
  const dateTh = dd && mm ? `${dd} ${TH_MONTHS[Number(mm) - 1] ?? mm} ${slot.th}` : "";
  const dateZh = dd && mm ? `${Number(mm)}月${dd}号${slot.zh}` : "";
  // header values: the day's default, unless every rider shares another one
  const uniq = (pick: (p: Person) => string, fallback: string) => {
    const v = Array.from(new Set(people.map((p) => pick(p) || fallback).filter(Boolean)));
    return v.length === 1 ? v[0] : fallback;
  };
  const headFlight = uniq((p) => p.fields.flight, meta.flight);
  const headLand = uniq((p) => p.fields.landTime, meta.landTime);
  const headReturn = uniq((p) => p.fields.returnBy, meta.returnBy);
  const accent = car.accent;
  const cols = people.length <= 1 ? 1 : 2;

  return (
    <div ref={ref} style={{ width: 1000, padding: 22, background: "linear-gradient(135deg,#eef2ff 0%,#f8fafc 45%,#e2e8f0 100%)", fontFamily: FONT, position: "relative", overflow: "hidden", boxSizing: "border-box" }}>
      <div style={{ position: "absolute", right: -90, top: -90, width: 300, height: 300, borderRadius: "50%", background: accent, opacity: 0.08 }} />
      <div style={{ position: "absolute", left: -70, bottom: -110, width: 260, height: 260, borderRadius: "50%", background: accent, opacity: 0.07 }} />

      {/* header band */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: accent, color: "#fff", borderRadius: 16, padding: "12px 20px", boxShadow: "0 4px 14px rgba(0,0,0,.18)", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 38, lineHeight: 1 }}>🚗</div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.1 }}>รถคันที่ {car.id} · {ZH_NUM[Number(car.id)] ?? car.id}号车</div>
            <div style={{ fontSize: 13, opacity: 0.9, marginTop: 3 }}>{car.name} {car.color} · {car.colorZh} · ทะเบียน {car.plate}</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.85 }}>VISA RUN · 签证跑</div>
          <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2 }}>{dateTh}</div>
          <div style={{ fontSize: 15, opacity: 0.95 }}>{dateZh}</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 14, position: "relative" }}>
        {/* riders */}
        <div style={{ ...PANEL, flex: "0 0 560px", padding: "18px 14px" }}>
          {people.length === 0 && <div style={{ color: "#999", textAlign: "center", padding: 40 }}>ยังไม่มีคนในคันนี้</div>}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "20px 12px", justifyItems: "center" }}>
            {people.map((p, i) => {
              const f = p.fields;
              const flight = f.flight && f.flight !== headFlight ? f.flight : "";
              const land = f.landTime && f.landTime !== headLand ? f.landTime : "";
              const ret = f.returnBy && f.returnBy !== headReturn ? f.returnBy : "";
              return (
                <div key={p.id} style={{ textAlign: "center", width: 240 }}>
                  <div style={{ position: "relative", display: "inline-block" }}>
                    <CardPhoto person={p} />
                    <span style={{ position: "absolute", top: -8, left: -8, width: 30, height: 30, borderRadius: "50%", background: accent, color: "#fff", fontSize: 14, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,.3)" }}>{i + 1}</span>
                    {f.run === "RUN30" && <span style={{ position: "absolute", bottom: -6, right: -6, background: "#ea580c", color: "#fff", borderRadius: 8, fontSize: 11, fontWeight: 700, padding: "2px 7px", boxShadow: "0 1px 3px rgba(0,0,0,.3)" }}>+30</span>}
                  </div>
                  <div style={{ fontFamily: "'Courier New', ui-monospace, monospace", fontSize: 21, fontWeight: 700, color: "#111", marginTop: 8, letterSpacing: 0.5, lineHeight: 1.1 }}>{[f.firstName, f.lastName].filter(Boolean).join(" ") || " "}</div>
                  <div style={{ fontSize: 27, color: "#111", lineHeight: 1.2 }}>{f.chineseName || " "}</div>
                  {(flight || land || ret) && (
                    <div style={{ marginTop: 3, display: "inline-block", background: "#fee2e2", color: "#991b1b", borderRadius: 8, padding: "2px 8px", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
                      {flight && `✈ ${flight} `}{land && `ลง ${land} `}{ret && `· กลับก่อน ${ret}`}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* flight / return / car */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
          {(headFlight || headLand) && (
            <div style={{ ...PANEL, padding: "14px 16px", textAlign: "center" }}>
              <div style={{ fontSize: 11, letterSpacing: 2, color: "#666" }}>✈ FLIGHT · 航班</div>
              {headFlight && <div style={{ fontSize: 40, fontWeight: 800, color: "#111", letterSpacing: 1, lineHeight: 1.1 }}>{headFlight}</div>}
              {headLand && (
                <>
                  <div style={{ marginTop: 6, display: "inline-block", background: "#ffeb3b", borderRadius: 12, padding: "6px 18px", fontSize: 24, fontWeight: 700, color: "#111", whiteSpace: "nowrap" }}>🛬 เครื่องลง {headLand} น</div>
                  <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>落地 {headLand}</div>
                </>
              )}
            </div>
          )}
          {headReturn && (
            <div style={{ background: "#ffb3b8", borderRadius: 16, padding: "12px 14px", textAlign: "center", boxShadow: "0 2px 10px rgba(0,0,0,.08)" }}>
              <div style={{ fontSize: 23, fontWeight: 800, color: "#1a1aa6", whiteSpace: "nowrap", lineHeight: 1.2 }}>⏰ กลับถึงสนามบินก่อน {headReturn} น</div>
              <div style={{ fontSize: 15, color: "#1a1aa6", marginTop: 2 }}>{headReturn} 前回到机场</div>
            </div>
          )}
          <div style={{ ...PANEL, padding: 12, textAlign: "center", marginTop: "auto" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={car.image} alt={car.name} style={{ width: "100%", height: 240, objectFit: "cover", borderRadius: 12, boxShadow: "0 3px 12px rgba(0,0,0,.2)" }} crossOrigin="anonymous" />
            <div style={{ marginTop: 10, display: "inline-block", background: "#fff", color: "#111", border: "3px solid #111", borderRadius: 8, padding: "3px 18px", fontSize: 26, fontWeight: 800, letterSpacing: 2, boxShadow: "0 2px 6px rgba(0,0,0,.25)" }}>{car.plate}</div>
            <div style={{ fontSize: 13, color: "#555", marginTop: 6 }}>{car.name} · {car.color} {car.colorZh} · {car.province}</div>
          </div>
        </div>
      </div>

      {/* meeting point after landing — replaces the separate guide picture */}
      <div style={{ ...PANEL, marginTop: 14, padding: "12px 14px", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span style={{ background: "#1e3a8a", color: "#fff", borderRadius: 10, padding: "4px 12px", fontSize: 16, fontWeight: 800 }}>📍 จุดนัดพบหลังลงเครื่อง · 下飞机后的集合地点</span>
          <span style={{ background: "#ffeb3b", color: "#111", borderRadius: 10, padding: "4px 12px", fontSize: 16, fontWeight: 800 }}>ประตู {MEETING_POINT.gate} · {MEETING_POINT.gate}号门</span>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "stretch" }}>
          <div style={{ flex: "0 0 300px", textAlign: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={MEETING_POINT.insideImage} alt="" style={{ width: 300, height: 190, objectFit: "cover", borderRadius: 10, boxShadow: "0 2px 8px rgba(0,0,0,.18)" }} crossOrigin="anonymous" />
            <div style={{ fontSize: 12, color: "#333", marginTop: 4, fontWeight: 700 }}>🏢 ภายในอาคาร · 航站楼内 — พบกันที่ประตู {MEETING_POINT.gate}</div>
          </div>
          <div style={{ flex: "0 0 300px", textAlign: "center" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={MEETING_POINT.outsideImage} alt="" style={{ width: 300, height: 190, objectFit: "cover", borderRadius: 10, boxShadow: "0 2px 8px rgba(0,0,0,.18)" }} crossOrigin="anonymous" />
            <div style={{ fontSize: 12, color: "#333", marginTop: 4, fontWeight: 700 }}>🚪 ภายนอกอาคาร · 航站楼外 — รอรถที่บริเวณประตู {MEETING_POINT.gate}</div>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 6 }}>
            {[
              { n: 1, icon: "🚶", th: <>หลังจากลงเครื่องแล้ว ให้เดินมาที่ <b>ประตู {MEETING_POINT.gate}</b></>, zh: `下飞机后，请先走到 ${MEETING_POINT.gate} 号门` },
              { n: 2, icon: "🚪", th: <>จากนั้นเดินออกไป <b>ภายนอกอาคาร</b></>, zh: "然后从这里走出到航站楼外" },
              { n: 3, icon: "🚗", th: <>มองหารถ <b>{car.name} {car.color}</b> ทะเบียน <b style={{ background: "#111", color: "#fff", borderRadius: 6, padding: "0 6px" }}>{car.plate}</b></>, zh: `请找 ${car.colorZh} ${car.name} 车牌 ${car.plate}` },
            ].map((s) => (
              <div key={s.n} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ flex: "0 0 26px", width: 26, height: 26, borderRadius: "50%", background: accent, color: "#fff", fontSize: 13, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{s.n}</span>
                <div style={{ fontSize: 13, color: "#222", lineHeight: 1.3 }}>
                  <div>{s.icon} {s.th}</div>
                  <div style={{ color: "#1e3a8a", fontSize: 12 }}>{s.zh}</div>
                </div>
              </div>
            ))}
            <div style={{ fontSize: 12, color: "#555", marginTop: 2 }}>👥 {people.length} คน · โปรดรอที่บริเวณประตู {MEETING_POINT.gate} · 请在 {MEETING_POINT.gate} 号门附近等候</div>
          </div>
        </div>
      </div>
    </div>
  );
});
export default CarCard;

// The rider's face: the framed white-background photo when made, else the
// photo cropped out of the passport page, else the selfie.
function CardPhoto({ person: p }: { person: Person }) {
  const passport = p.files.find((x) => x.kind === "passport");
  const selfie = p.files.find((x) => x.kind === "selfie");
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    let u = "";
    (async () => {
      let blob: Blob | null = p.photo ?? null;
      if (!blob && passport) {
        try { blob = await cropPassportPhoto(passport.blob, passport.photoBox || ""); } catch { blob = null; }
      }
      if (!blob && selfie) blob = selfie.blob;
      if (!alive) return;
      if (!blob) { setUrl(""); return; }
      u = URL.createObjectURL(blob);
      setUrl(u);
    })();
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [p.photo, passport, selfie]);
  const box: React.CSSProperties = { width: 180, height: 236, objectFit: "cover", borderRadius: 12, border: "4px solid #fff", boxShadow: "0 3px 10px rgba(0,0,0,.22)", background: "#eee", display: "inline-block" };
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" style={box} /> : <div style={box} />;
}
