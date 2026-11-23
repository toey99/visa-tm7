"use client";

// =============================================================
// RunCostSheet — what we owe the checkpoint partner for the day (PNG)
// =============================================================
// One row per customer, grouped by car: the all-in per-head rate (depends on
// how many ride in that car), +30-day extension, 🐻 Cambodia, 🇮🇳 Lao visa,
// overstay fine, row total. Per-car subtotals, the day's total, the cash the
// drivers collected at the counter, and the net to transfer. Prices come
// from the dashboard's ⚙️ table (pricing/config.json).

import { forwardRef } from "react";
import { CARS } from "@/lib/visarun/cars";
import type { Pricing } from "@/lib/stats/pricing";

export type RunCostRow = {
  name: string; cn: string; carId: string; carSize: number;
  trip?: string;           // "2" = the car's second round (carSize counts that round only)
  run30: boolean; cambodia: boolean; indian: boolean; overstayDays: number;
  cash: number;            // cash the driver collected from this customer
};

const FONT = "system-ui, 'Noto Sans Thai', 'Noto Sans SC', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";
const CAR_TINT: Record<string, { bg: string; edge: string }> = {
  "1": { bg: "#fff6d6", edge: "#f2c94c" }, "2": { bg: "#ece7f8", edge: "#a78bfa" }, "3": { bg: "#e6f4e6", edge: "#6cc070" },
  "4": { bg: "#fde4ec", edge: "#f28bb0" }, "5": { bg: "#ffe8cc", edge: "#f0a040" }, "6": { bg: "#d9f4f9", edge: "#38bdf8" },
};
const n = (v: number) => (v ? v.toLocaleString("en-US") : "");

export function costOfRow(r: RunCostRow, p: Pricing) {
  const size = (Math.min(4, Math.max(1, r.carSize || 2)) as 1 | 2 | 3 | 4);
  const base = p.cost.runPerHead[size] ?? p.cost.runPerHead[2];
  const ext = r.run30 ? p.cost.run30 : 0;
  const kh = r.cambodia ? p.cost.cambodia : 0;
  const lao = r.indian ? p.cost.runIndian : 0;
  const fine = r.overstayDays > 0 ? p.cost.overstayPerDay * r.overstayDays : 0;
  return { base, ext, kh, lao, fine, total: base + ext + kh + lao + fine };
}

const RunCostSheet = forwardRef<HTMLDivElement, { rows: RunCostRow[]; date: string; pricing: Pricing }>(function RunCostSheet({ rows, date, pricing }, ref) {
  const sorted = [...rows].sort((a, b) => (a.carId || "9").localeCompare(b.carId || "9") || (a.trip || "").localeCompare(b.trip || ""));
  const priced = sorted.map((r) => ({ r, c: costOfRow(r, pricing) }));
  const total = priced.reduce((s, x) => s + x.c.total, 0);
  const cash = rows.reduce((s, r) => s + r.cash, 0);
  const carsUsed = CARS.filter((c) => rows.some((r) => r.carId === c.id));
  const anyExt = rows.some((r) => r.run30), anyKh = rows.some((r) => r.cambodia), anyLao = rows.some((r) => r.indian), anyFine = rows.some((r) => r.overstayDays > 0);
  const cols = ["40px", "1fr", "150px", "60px", "110px", anyExt ? "100px" : "", anyKh ? "100px" : "", anyLao ? "110px" : "", anyFine ? "110px" : "", "120px"].filter(Boolean).join(" ");
  const th: React.CSSProperties = { fontSize: 13, fontWeight: 800, color: "#1e293b", padding: "8px", textAlign: "right", borderBottom: "2px solid #7c2d12" };
  const td: React.CSSProperties = { fontSize: 15, color: "#0f172a", padding: "7px 8px", textAlign: "right", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };
  const rate = pricing.cost.runPerHead;

  // per-car subtotal rows interleaved
  const groups = carsUsed.map((c) => ({ car: c, items: priced.filter((x) => x.r.carId === c.id) }));
  const noCar = priced.filter((x) => !x.r.carId);
  if (noCar.length) groups.push({ car: { id: "", name: "ไม่ระบุรถ", plate: "", color: "", colorZh: "", province: "", image: "", seats: 4, accent: "#64748b" }, items: noCar });

  let idx = 0;
  return (
    <div ref={ref} style={{ width: 1100, padding: 18, background: "linear-gradient(135deg,#fff7ed,#fffbf5 50%,#ffedd5)", fontFamily: FONT, boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#7c2d12" }}>💰 ต้นทุนด่าน · VISA RUN {date}</div>
          <div style={{ fontSize: 12, color: "#9a3412", marginTop: 2 }}>ค่าเหมาต่อหัวตามจำนวนคนในรถ: 1 คน {n(rate[1])} · 2 คน {n(rate[2])} · 3 คน {n(rate[3])} · 4 คน {n(rate[4])}{anyExt ? ` · ต่อ 30 วัน +${n(pricing.cost.run30)}` : ""}{anyKh ? ` · 🐻 +${n(pricing.cost.cambodia)}` : ""}{anyLao ? ` · 🇮🇳 วีซ่าลาว +${n(pricing.cost.runIndian)}` : ""}{anyFine ? ` · 🐢 ค่าปรับ ${n(pricing.cost.overstayPerDay)}/วัน` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {carsUsed.map((c) => { const k = rows.filter((r) => r.carId === c.id).length; const t = CAR_TINT[c.id]; return <span key={c.id} style={{ background: t.bg, border: `2px solid ${t.edge}`, borderRadius: 999, padding: "3px 12px", fontSize: 13, fontWeight: 700 }}>{c.color} {c.plate.replace(/\D/g, "")} · {k} คน</span>; })}
        </div>
      </div>

      <div style={{ background: "#fff", borderRadius: 14, overflow: "hidden", boxShadow: "0 2px 12px rgba(124,45,18,.12)" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", background: "#fff1e6" }}>
          <div style={{ ...th, textAlign: "center" }}>ที่</div><div style={{ ...th, textAlign: "left" }}>ชื่อลูกค้า</div><div style={{ ...th, textAlign: "left" }}>รถ</div><div style={{ ...th, textAlign: "center" }}>คน/คัน</div><div style={th}>ค่าเหมา</div>
          {anyExt && <div style={th}>ต่อ 30 วัน</div>}{anyKh && <div style={th}>🐻 กัมพูชา</div>}{anyLao && <div style={th}>🇮🇳 วีซ่าลาว</div>}{anyFine && <div style={th}>🐢 ค่าปรับ</div>}
          <div style={th}>รวม</div>
        </div>
        {groups.map((g) => {
          const t = CAR_TINT[g.car.id];
          const sub = g.items.reduce((s, x) => s + x.c.total, 0);
          return (
            <div key={g.car.id || "none"}>
              {g.items.map(({ r, c }) => {
                idx++;
                return (
                  <div key={idx} style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", background: t?.bg ?? "#f8fafc", borderLeft: `6px solid ${t?.edge ?? "#cbd5e1"}`, borderBottom: "1px solid #f1e4d8" }}>
                    <div style={{ ...td, textAlign: "center", fontWeight: 700, color: "#475569" }}>{idx}</div>
                    <div style={{ ...td, textAlign: "left" }}><span style={{ fontWeight: 700, fontFamily: "'Courier New', ui-monospace, monospace" }}>{r.name || "—"}</span>{r.cn ? <span style={{ marginLeft: 8, color: "#334155" }}>{r.cn}</span> : null}{r.indian ? <span style={{ marginLeft: 8 }}>🇮🇳</span> : null}</div>
                    <div style={{ ...td, textAlign: "left" }}>{g.car.id ? `${g.car.color} ${g.car.plate.replace(/\D/g, "")}${r.trip === "2" ? " รอบ 2" : ""}` : "—"}</div>
                    <div style={{ ...td, textAlign: "center" }}>{r.carSize || "—"}</div>
                    <div style={td}>{n(c.base)}</div>
                    {anyExt && <div style={{ ...td, color: "#c2410c" }}>{n(c.ext)}</div>}
                    {anyKh && <div style={{ ...td, color: "#92400e" }}>{n(c.kh)}</div>}
                    {anyLao && <div style={{ ...td, color: "#1d4ed8" }}>{n(c.lao)}</div>}
                    {anyFine && <div style={{ ...td, color: "#15803d" }}>{c.fine ? `${n(c.fine)} (${r.overstayDays} วัน)` : ""}</div>}
                    <div style={{ ...td, fontWeight: 800 }}>{n(c.total)}</div>
                  </div>
                );
              })}
              <div style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", background: "#fafafa", borderLeft: `6px solid ${t?.edge ?? "#cbd5e1"}`, borderBottom: "2px solid #e7d5c6", color: "#7c2d12", fontWeight: 800 }}>
                <div></div><div style={{ ...td, textAlign: "left", fontSize: 13 }}>รวม {g.car.id ? `${g.car.name} ${g.car.plate}` : "ไม่ระบุรถ"} · {g.items.length} คน</div>
                <div></div><div></div><div></div>{anyExt && <div></div>}{anyKh && <div></div>}{anyLao && <div></div>}{anyFine && <div></div>}
                <div style={{ ...td, fontSize: 16 }}>{n(sub)}</div>
              </div>
            </div>
          );
        })}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 220px 180px", alignItems: "center", background: "#7c2d12", color: "#fff", padding: "10px 14px", gap: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>รวมต้นทุนด่านวันนี้ · {rows.length} คน · {carsUsed.length} คัน</div>
          <div style={{ textAlign: "right", fontSize: 13, opacity: 0.9 }}>{cash ? `เงินสดที่คนขับเก็บ ${n(cash)}` : ""}</div>
          <div style={{ textAlign: "right", fontSize: 24, fontWeight: 900, fontVariantNumeric: "tabular-nums" }}>{n(total)}</div>
        </div>
        {cash > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 180px", background: "#fff7ed", color: "#7c2d12", padding: "8px 14px", fontWeight: 800 }}>
            <div style={{ fontSize: 14 }}>ยอดสุทธิที่ต้องโอนให้ด่าน = ต้นทุน {n(total)} − เงินสดที่คนขับเก็บ {n(cash)}</div>
            <div style={{ textAlign: "right", fontSize: 20, fontVariantNumeric: "tabular-nums" }}>{total - cash < 0 ? `−${n(cash - total)}` : n(total - cash)}</div>
          </div>
        )}
      </div>
    </div>
  );
});

export default RunCostSheet;
