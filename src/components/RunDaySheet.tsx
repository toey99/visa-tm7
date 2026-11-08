"use client";

// =============================================================
// RunDaySheet — visa-run day table for the checkpoint partner (PNG)
// =============================================================
// The partner gets this as a picture (cropped from a sheet before). One row
// per customer, rows tinted by car — the car cost depends on how many ride
// in each — plus the extras that change the price (30-day extension,
// overstay days, 🐻 Cambodia history) and the cash the driver collects.
// Rendered off-screen in DayBoard and exported with html-to-image.

import { forwardRef } from "react";
import { CARS } from "@/lib/visarun/cars";
import type { RunSheetRow } from "@/lib/today/clientTools";

const FONT = "system-ui, 'Noto Sans Thai', 'Noto Sans SC', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";
// soft tints per car id — same family as the partner's old sheet
const CAR_TINT: Record<string, { bg: string; edge: string }> = {
  "1": { bg: "#fff6d6", edge: "#f2c94c" },   // MG 4967 — yellow
  "2": { bg: "#ece7f8", edge: "#a78bfa" },   // March 2322 — lavender
  "3": { bg: "#e6f4e6", edge: "#6cc070" },   // Vios 1858 — green
  "4": { bg: "#fde4ec", edge: "#f28bb0" },   // Camry 7397 — pink
  "5": { bg: "#ffe8cc", edge: "#f0a040" },   // taxi 236 — orange
  "6": { bg: "#d9f4f9", edge: "#38bdf8" },   // BYD 2896 — sky
};

const RunDaySheet = forwardRef<HTMLDivElement, { rows: RunSheetRow[]; date: string }>(function RunDaySheet({ rows, date }, ref) {
  const sorted = [...rows].sort((a, b) => (a.carId || "9").localeCompare(b.carId || "9"));
  const cashSum = rows.reduce((s, r) => s + r.cash, 0);
  const fineSum = rows.reduce((s, r) => s + r.fine, 0);
  const anyFine = fineSum > 0;
  const carsUsed = CARS.filter((c) => rows.some((r) => r.carId === c.id));
  const cols = anyFine ? "44px 1fr 88px 86px 104px 112px 120px 1.1fr 44px 120px 110px" : "44px 1fr 92px 90px 110px 118px 130px 1.1fr 48px 120px";
  const th: React.CSSProperties = { fontSize: 13, fontWeight: 800, color: "#1e293b", padding: "8px 8px", textAlign: "center", borderBottom: "2px solid #1e3a8a" };
  return (
    <div ref={ref} style={{ width: 1180, padding: 18, background: "linear-gradient(135deg,#eef2ff,#f8fafc 50%,#e2e8f0)", fontFamily: FONT, boxSizing: "border-box" }}>
      {/* title */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#1e3a8a" }}>🚗 VISA RUN · DAY {date}</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {carsUsed.map((c) => {
            const n = rows.filter((r) => r.carId === c.id).length;
            const t = CAR_TINT[c.id];
            return <span key={c.id} style={{ background: t.bg, border: `2px solid ${t.edge}`, borderRadius: 999, padding: "3px 12px", fontSize: 13, fontWeight: 700, color: "#1e293b" }}>{c.color} {c.plate.replace(/\D/g, "")} · {n} คน</span>;
          })}
        </div>
      </div>

      {/* table */}
      <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 12px rgba(30,58,138,.10)" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", background: "#f1f5f9" }}>
          <div style={th}>ที่</div><div style={{ ...th, textAlign: "left" }}>ชื่อลูกค้า</div><div style={th}>flight ขาไป</div><div style={th}>ลงเชียงราย</div><div style={th}>ถึงสนามบินก่อน</div><div style={th}>วีซ่าหมดวันที่</div><div style={{ ...th, textAlign: "left" }}>รถ</div><div style={{ ...th, textAlign: "left" }}>รายละเอียด</div><div style={th}>🐻</div><div style={{ ...th, textAlign: "right" }}>ลูกค้าจ่ายเงินสด</div>{anyFine && <div style={{ ...th, textAlign: "right" }}>🐢 ค่าปรับ</div>}
        </div>
        {sorted.map((r, i) => {
          const t = CAR_TINT[r.carId];
          const td: React.CSSProperties = { fontSize: 15, color: "#0f172a", padding: "7px 8px", textAlign: "center", whiteSpace: "nowrap" };
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", background: t?.bg ?? (i % 2 ? "#f8fafc" : "#fff"), borderLeft: `6px solid ${t?.edge ?? "transparent"}`, borderBottom: "1px solid #e2e8f0" }}>
              <div style={{ ...td, fontWeight: 700, color: "#475569" }}>{i + 1}</div>
              <div style={{ ...td, textAlign: "left", fontWeight: 700, fontFamily: "'Courier New', ui-monospace, monospace", letterSpacing: 0.3 }}>{r.name || "—"}</div>
              <div style={{ ...td, fontWeight: 700 }}>{r.flight}</div>
              <div style={td}>{r.land}</div>
              <div style={td}>{r.returnBy}</div>
              <div style={{ ...td, fontWeight: 700, color: "#1e3a8a" }}>{r.expiry}</div>
              <div style={{ ...td, textAlign: "left" }}>{r.carLabel}</div>
              <div style={{ ...td, textAlign: "left", whiteSpace: "normal", color: r.detail ? "#9a3412" : "#94a3b8", fontWeight: r.detail ? 700 : 400 }}>{r.detail || ""}</div>
              <div style={{ ...td, fontSize: 24, lineHeight: 1 }}>{r.bear ? "🐻" : ""}</div>
              <div style={{ ...td, textAlign: "right", fontWeight: 800, color: r.cash ? "#b91c1c" : "#94a3b8" }}>{r.cash ? r.cash.toLocaleString() : ""}</div>
              {anyFine && <div style={{ ...td, textAlign: "right", fontWeight: 800, color: r.fine ? "#15803d" : "#94a3b8" }}>{r.fine ? r.fine.toLocaleString() : ""}</div>}
            </div>
          );
        })}
        {/* totals */}
        <div style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", background: "#e0e7ff", fontWeight: 800, color: "#1e3a8a" }}>
          <div style={{ padding: "8px" }}></div>
          <div style={{ padding: "8px", fontSize: 15 }}>รวม {rows.length} คน</div>
          <div></div><div></div><div></div><div></div>
          <div style={{ padding: "8px", fontSize: 14 }}>{carsUsed.length} คัน</div>
          <div style={{ padding: "8px", fontSize: 14 }}>ต่อ 30 วัน {rows.filter((r) => /ต่ออายุ/.test(r.detail)).length} คน{rows.some((r) => /อยู่เกิน/.test(r.detail)) ? ` · อยู่เกิน ${rows.filter((r) => /อยู่เกิน/.test(r.detail)).length} คน` : ""}</div>
          <div style={{ padding: "8px", textAlign: "center", fontSize: 15 }}>{rows.filter((r) => r.bear).length || ""}</div>
          <div style={{ padding: "8px", textAlign: "right", fontSize: 16, color: "#b91c1c" }}>{cashSum ? cashSum.toLocaleString() : ""}</div>
          {anyFine && <div style={{ padding: "8px", textAlign: "right", fontSize: 16, color: "#15803d" }}>{fineSum.toLocaleString()}</div>}
        </div>
        {anyFine && <div style={{ padding: "6px 12px", fontSize: 12, color: "#475569", background: "#f8fafc" }}>🐢 ค่าปรับ overstay = 2,000 + 500 × จำนวนวัน</div>}
      </div>
    </div>
  );
});
export default RunDaySheet;
