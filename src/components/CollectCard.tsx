"use client";

// =============================================================
// CollectCard — "amount to collect" picture for one customer
// =============================================================
// Replaces the old passport-page-with-red-digits image. Same look as the
// daily summary (office colours, header band, white panel): the customer's
// face, name (surname first, EN + 中文), passport number and the amount in a
// big yellow box, so the right person pays the right amount at the counter.
// Rendered off-screen in DayBoard and exported with html-to-image.

import { forwardRef, useEffect, useState } from "react";
import type { DayMeta, Person } from "@/lib/today/types";
import { OFFICES } from "@/lib/offices";

const FONT = "system-ui, 'Noto Sans Thai', 'Noto Sans SC', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

function useBlobUrl(blob: Blob | null | undefined): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    if (!blob) { setUrl(""); return; }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

const CollectCard = forwardRef<HTMLDivElement, { person: Person; meta: DayMeta; run?: boolean }>(function CollectCard({ person: p, meta, run = false }, ref) {
  // visa-run customers pay the driver on the day; extension customers pay at the counter
  const payAt = run ? "ชำระกับคนขับรถ · 请付给司机" : "ชำระที่เจ้าหน้าที่ · 请向工作人员付款";
  const footer = run ? "กรุณาแสดงรูปนี้กับคนขับรถตอนชำระเงิน · 付款时请向司机出示此图" : "กรุณาแสดงรูปนี้ตอนชำระเงิน · 付款时请出示此图";
  const f = p.fields;
  const o = OFFICES[meta.office];
  const accent = o.summaryAccent;
  const face = p.photo ?? p.files.find((x) => x.kind === "selfie")?.blob ?? p.files.find((x) => x.kind === "passport")?.blob ?? null;
  const faceUrl = useBlobUrl(face);
  const amount = Number(f.amount) || 0;
  const [dd, mm, yy] = meta.date.split("/");
  const dateTh = dd && mm ? `${Number(dd)} ${TH_MONTHS[Number(mm) - 1] ?? mm} ${Number(yy) + 543}` : meta.date;
  const dateZh = dd && mm ? `${yy}年${Number(mm)}月${Number(dd)}日` : "";
  const nameEn = [f.lastName, f.firstName].filter(Boolean).join(" ");

  return (
    <div ref={ref} style={{ width: 720, padding: 20, background: o.summaryBg, fontFamily: FONT, position: "relative", overflow: "hidden", boxSizing: "border-box" }}>
      <div style={{ position: "absolute", right: -70, top: -70, width: 240, height: 240, borderRadius: "50%", background: accent, opacity: 0.08 }} />
      <div style={{ position: "absolute", left: -60, bottom: -90, width: 200, height: 200, borderRadius: "50%", background: accent, opacity: 0.06 }} />

      {/* header band */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: accent, color: "#fff", borderRadius: 14, padding: "12px 18px", boxShadow: "0 4px 14px rgba(0,0,0,.15)", position: "relative" }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.1 }}>💰 ค่าบริการที่ต้องชำระ</div>
          <div style={{ fontSize: 13, opacity: 0.9, marginTop: 3 }}>应付服务费 · AMOUNT DUE</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.85 }}>{o.emoji} {o.summaryTitle}</div>
          <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.2 }}>{dateTh}</div>
          <div style={{ fontSize: 12, opacity: 0.95 }}>{dateZh}</div>
        </div>
      </div>

      {/* who */}
      <div style={{ background: "rgba(255,255,255,.94)", borderRadius: 14, padding: 16, marginTop: 12, boxShadow: "0 2px 10px rgba(0,0,0,.06)", position: "relative", display: "flex", gap: 18, alignItems: "stretch" }}>
        <div style={{ flex: "0 0 180px", position: "relative" }}>
          {faceUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={faceUrl} alt="" style={{ width: 180, height: 234, objectFit: "cover", borderRadius: 10, boxShadow: "0 2px 8px rgba(0,0,0,.25)", display: "block" }} />
            : <div style={{ width: 180, height: 234, background: "#eee", borderRadius: 10 }} />}
          <span style={{ position: "absolute", top: -8, left: -8, width: 30, height: 30, borderRadius: "50%", background: accent, color: "#fff", fontSize: 14, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 4px rgba(0,0,0,.3)" }}>{String(p.order).padStart(2, "0")}</span>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
          <div style={{ fontFamily: "'Courier New', ui-monospace, monospace", fontSize: 30, fontWeight: 700, color: "#111", letterSpacing: 0.5, lineHeight: 1.1, wordBreak: "break-word" }}>{nameEn || "—"}</div>
          <div style={{ fontSize: 38, color: "#111", lineHeight: 1.2, marginTop: 2 }}>{f.chineseName || " "}</div>
          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
            {f.passportNo && <span style={{ fontFamily: "'Courier New', ui-monospace, monospace", background: "#f1f5f9", color: "#0f172a", borderRadius: 8, padding: "4px 10px", fontSize: 16, fontWeight: 700, letterSpacing: 1 }}>🛂 {f.passportNo}</span>}
            {f.nationality && <span style={{ background: "#f1f5f9", color: "#334155", borderRadius: 8, padding: "4px 10px", fontSize: 14, fontWeight: 700 }}>{f.nationality}</span>}
          </div>
          {f.agent && <div style={{ marginTop: 10, fontSize: 14, color: "#4338ca", fontWeight: 700 }}>🏢 {f.agent}{f.subAgent ? ` ↳ ${f.subAgent}` : ""}</div>}
        </div>
      </div>

      {/* amount */}
      <div style={{ marginTop: 12, background: "#ffeb3b", borderRadius: 14, padding: "14px 18px", boxShadow: "0 2px 10px rgba(0,0,0,.1)", position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", border: `3px solid ${accent}` }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 800, color: "#4a3b00", letterSpacing: 1 }}>ยอดที่ต้องชำระ · 应付金额</div>
          <div style={{ fontSize: 13, color: "#6b5a00", marginTop: 2, fontWeight: 700 }}>{run ? "🚗 " : ""}{payAt}</div>
          {f.note && <div style={{ fontSize: 12, color: "#6b5a00", marginTop: 2 }}>📝 {f.note}</div>}
        </div>
        <div style={{ textAlign: "right", lineHeight: 1 }}>
          <span style={{ fontSize: 30, fontWeight: 800, color: "#7a1020", verticalAlign: "top", marginRight: 6 }}>฿</span>
          <span style={{ fontSize: 64, fontWeight: 900, color: "#c8102e", letterSpacing: 1 }}>{amount.toLocaleString("en-US")}</span>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#4a3b00", marginTop: 4 }}>บาท · 泰铢 · THB</div>
        </div>
      </div>

      {/* footer */}
      <div style={{ marginTop: 10, padding: "0 4px", fontSize: 12, color: "#555", position: "relative", textAlign: "center" }}>{footer}</div>
    </div>
  );
});

export default CollectCard;
