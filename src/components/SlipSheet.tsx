"use client";

// =============================================================
// SlipSheet — one picture for a whole accounting round
// =============================================================
// Every transfer slip of the round as a thumbnail (numbered, with its amount),
// then a table: #, when, who/bank, amount, and the total. Sent to the agency
// with the closing note so both sides look at the same list.
// Exported with captureNode like the other sheets (shadows flattened).

import { forwardRef } from "react";
import { bkkTime, counted, dayTh, formula, money, total, type SlipItem } from "@/lib/slips/types";

const FONT = "system-ui, 'Noto Sans Thai', 'Noto Sans SC', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";
const fileUrl = (path: string) => `/api/slips/file?path=${encodeURIComponent(path)}`;

// `srcOf` gives each slip its own data: URL — html-to-image otherwise served
// the same picture for every thumbnail when they came from the file route.
const SlipSheet = forwardRef<HTMLDivElement, { book: string; day: string; items: SlipItem[]; closedAt?: number; srcOf?: (it: SlipItem) => string }>(function SlipSheet({ book, day, items, closedAt, srcOf }, ref) {
  const list = items.filter(counted);
  const skipped = items.filter((i) => !counted(i));
  const accent = "#0d9488";
  const cols = list.length <= 4 ? Math.max(list.length, 1) : 5;
  return (
    <div ref={ref} style={{ width: 1000, padding: 22, background: "linear-gradient(135deg,#ccfbf1,#f0f9ff 45%,#ede9fe)", fontFamily: FONT, boxSizing: "border-box" }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: accent, color: "#fff", borderRadius: 16, padding: "12px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 36, lineHeight: 1 }}>🧾</div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>สลิปโอน · {book}</div>
            <div style={{ fontSize: 13, opacity: 0.92, marginTop: 3 }}>รอบ {dayTh(day)}{closedAt ? ` · ตัดจบ ${bkkTime(closedAt)} น.` : " · ยังไม่ตัดจบ"}</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.85 }}>TRANSFERS · 转账汇总</div>
          <div style={{ fontSize: 26, fontWeight: 800, lineHeight: 1.2 }}>{money(total(items))} บาท</div>
          <div style={{ fontSize: 13, opacity: 0.92 }}>{list.length} ใบ</div>
        </div>
      </div>

      {/* thumbnails */}
      <div style={{ background: "rgba(255,255,255,.92)", borderRadius: 16, padding: 14, marginTop: 12 }}>
        {list.length === 0 && <div style={{ textAlign: "center", color: "#999", padding: 24 }}>ไม่มีสลิปที่นับในรอบนี้</div>}
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 12 }}>
          {list.map((it, i) => (
            <div key={it.id} style={{ textAlign: "center" }}>
              <div style={{ position: "relative", background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden", height: 300, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={srcOf ? srcOf(it) : fileUrl(it.img)} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />
                <span style={{ position: "absolute", top: 6, left: 6, width: 26, height: 26, borderRadius: "50%", background: accent, color: "#fff", fontSize: 13, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</span>
              </div>
              <div style={{ marginTop: 6, fontSize: 18, fontWeight: 800, color: "#0f172a" }}>{money(it.amount)}</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>{[it.paidDate, it.paidTime].filter(Boolean).join(" ")}</div>
            </div>
          ))}
        </div>
      </div>

      {/* table */}
      <div style={{ background: "rgba(255,255,255,.94)", borderRadius: 16, padding: "10px 14px", marginTop: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "40px 150px 1fr 140px 150px", gap: "0 10px", padding: "6px 4px", borderBottom: `2px solid ${accent}`, fontSize: 12, fontWeight: 700, color: "#555" }}>
          <div>#</div><div>วัน-เวลาโอน</div><div>ผู้โอน · ธนาคาร</div><div>อ้างอิง</div><div style={{ textAlign: "right" }}>ยอด (บาท)</div>
        </div>
        {list.map((it, i) => (
          <div key={it.id} style={{ display: "grid", gridTemplateColumns: "40px 150px 1fr 140px 150px", gap: "0 10px", padding: "7px 4px", borderBottom: "1px solid #eee", fontSize: 14, color: "#1e293b", background: i % 2 ? "rgba(204,251,241,.35)" : undefined, alignItems: "center" }}>
            <div style={{ fontWeight: 700, color: accent }}>{i + 1}</div>
            <div>{[it.paidDate, it.paidTime].filter(Boolean).join(" ") || "—"}</div>
            <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.sender || "—"}{it.bank ? ` · ${it.bank}` : ""}</div>
            <div style={{ fontSize: 11, color: "#64748b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.ref || ""}</div>
            <div style={{ textAlign: "right", fontWeight: 800, fontSize: 17 }}>{money(it.amount)}</div>
          </div>
        ))}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: "0 10px", padding: "10px 4px 4px", alignItems: "center" }}>
          <div style={{ fontSize: 13, color: "#334155", wordBreak: "break-all" }}>{formula(items)}</div>
          <div style={{ textAlign: "right", fontSize: 24, fontWeight: 900, color: accent }}>{money(total(items))}</div>
        </div>
        {skipped.length > 0 && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>ไม่นับ {skipped.length} ใบ ({skipped.map((s) => (s.dupOf ? "ซ้ำ" : !s.isSlip ? "ไม่ใช่สลิป" : "ตัดออก")).join(", ")})</div>}
      </div>

      <div style={{ marginTop: 10, padding: "0 6px", fontSize: 11, color: "#475569" }}>ยอดจากสลิปที่ส่งเข้าห้องสลิป · กรุณาตรวจกับรายการธนาคารอีกครั้ง</div>
    </div>
  );
});
export default SlipSheet;
