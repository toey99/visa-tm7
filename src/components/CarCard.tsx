"use client";

// =============================================================
// CarCard — one seating card per car for the visa-run board
// =============================================================
// Sent to the customers riding that car: their photos + names (EN / 中文),
// the date pills (TH / 中文 with the time slot), the flight + landing time,
// the "be back at the airport before …" box and the car photo + plate.
// Rendered on screen and exported with html-to-image (same as the summary).

import { forwardRef, useEffect, useState } from "react";
import type { Car } from "@/lib/visarun/cars";
import { RUN_SLOTS } from "@/lib/visarun/cars";
import type { DayMeta, Person } from "@/lib/today/types";
import { cropPassportPhoto } from "@/lib/today/photoTools";

const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const FONT = "system-ui, 'Noto Sans Thai', 'Noto Sans SC', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";

const CarCard = forwardRef<HTMLDivElement, { car: Car; people: Person[]; meta: DayMeta }>(function CarCard({ car, people, meta }, ref) {
  const [dd, mm] = meta.date.split("/");
  const slot = RUN_SLOTS.find((s) => s.id === (meta.slot || "morning")) ?? RUN_SLOTS[0];
  const dateTh = dd && mm ? `${dd} ${TH_MONTHS[Number(mm) - 1] ?? mm} ${slot.th}` : "";
  const dateZh = dd && mm ? `${Number(mm)}月${dd}号${slot.zh}` : "";
  // flight shown in the header: the day's default, unless every rider shares another one
  const flights = Array.from(new Set(people.map((p) => p.fields.flight || meta.flight).filter(Boolean)));
  const headFlight = flights.length === 1 ? flights[0] : meta.flight;
  const lands = Array.from(new Set(people.map((p) => p.fields.landTime || meta.landTime).filter(Boolean)));
  const headLand = lands.length === 1 ? lands[0] : meta.landTime;
  const returns = Array.from(new Set(people.map((p) => p.fields.returnBy || meta.returnBy).filter(Boolean)));
  const headReturn = returns.length === 1 ? returns[0] : meta.returnBy;
  const cols = people.length <= 2 ? people.length || 1 : 2;

  return (
    <div ref={ref} style={{ width: 1000, padding: 28, background: "#fff", fontFamily: FONT, display: "flex", gap: 28, position: "relative" }}>
      {/* left: riders */}
      <div style={{ flex: "0 0 560px", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
          <span style={{ background: car.accent, color: "#fff", borderRadius: 10, padding: "4px 12px", fontSize: 18, fontWeight: 800 }}>🚗 รถคันที่ {car.id}</span>
          <span style={{ fontSize: 15, color: "#333" }}>{car.name} {car.color} · {car.colorZh}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: "22px 16px", justifyItems: "center", alignContent: "start", flex: 1 }}>
          {people.length === 0 && <div style={{ color: "#999", padding: 40 }}>ยังไม่มีคนในคันนี้</div>}
          {people.map((p) => {
            const f = p.fields;
            const flight = f.flight && f.flight !== headFlight ? f.flight : "";
            const land = f.landTime && f.landTime !== headLand ? f.landTime : "";
            const ret = f.returnBy && f.returnBy !== headReturn ? f.returnBy : "";
            return (
              <div key={p.id} style={{ textAlign: "center", width: 230 }}>
                <CardPhoto person={p} />
                <div style={{ fontFamily: "'Courier New', ui-monospace, monospace", fontSize: 24, fontWeight: 700, color: "#111", marginTop: 10, letterSpacing: 1, lineHeight: 1.1 }}>{[f.firstName, f.lastName].filter(Boolean).join(" ") || " "}</div>
                <div style={{ fontSize: 30, color: "#111", lineHeight: 1.2 }}>{f.chineseName || " "}</div>
                {(flight || land || ret) && (
                  <div style={{ marginTop: 4, fontSize: 13, color: "#b91c1c", fontWeight: 700 }}>
                    {flight && `✈ ${flight} `}{land && `ลง ${land} `}{ret && `· กลับก่อน ${ret}`}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* right: date / flight / return / car */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
        <div style={{ background: "#ffeb3b", color: "#111", borderRadius: 14, padding: "8px 26px", fontSize: 30, fontWeight: 700 }}>{dateTh}</div>
        <div style={{ background: "#ffeb3b", color: "#111", borderRadius: 12, padding: "6px 22px", fontSize: 26, fontWeight: 700 }}>{dateZh}</div>
        {(headFlight || headLand) && (
          <div style={{ textAlign: "center", marginTop: 4 }}>
            {headFlight && <div style={{ fontSize: 40, fontWeight: 800, color: "#111", letterSpacing: 1 }}>{headFlight}</div>}
            {headLand && <div style={{ fontSize: 38, fontWeight: 800, color: "#111", lineHeight: 1.1, whiteSpace: "nowrap" }}>เครื่องลง {headLand} น</div>}
          </div>
        )}
        {headReturn && (
          <div style={{ background: "#ffb3b8", color: "#1a1aa6", borderRadius: 18, padding: "14px 22px", fontSize: 26, fontWeight: 700, textAlign: "center", lineHeight: 1.2, whiteSpace: "nowrap" }}>
            กลับถึงสนามบินก่อน {headReturn} น
          </div>
        )}
        <div style={{ marginTop: "auto", width: "100%", textAlign: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={car.image} alt={car.name} style={{ width: 360, height: 330, objectFit: "cover", borderRadius: 16, boxShadow: "0 3px 12px rgba(0,0,0,.2)" }} crossOrigin="anonymous" />
          <div style={{ marginTop: 8, display: "inline-block", background: "#111", color: "#fff", borderRadius: 10, padding: "6px 18px", fontSize: 26, fontWeight: 800, letterSpacing: 2 }}>{car.plate}</div>
          <div style={{ fontSize: 13, color: "#555", marginTop: 4 }}>{car.name} · {car.color} {car.colorZh} · {car.province}</div>
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
  const box: React.CSSProperties = { width: 190, height: 250, objectFit: "cover", borderRadius: 6, boxShadow: "0 2px 6px rgba(0,0,0,.25)", background: "#eee", display: "inline-block" };
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" style={box} /> : <div style={box} />;
}
