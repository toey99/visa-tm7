"use client";

// =============================================================
// ExpiryReport — "visa expiry" infographic (TH / 中文)
// =============================================================
// Used in two places:
//  • the day boards (/today, /visarun): the evening report for the factory /
//    agent, built from the day's people (with their photos)
//  • /expiry: the reminder for people whose visa is about to run out, built
//    from the expiry ledger (no photos)
// Exported with html-to-image like the other sheets.

import { forwardRef, useEffect, useState } from "react";
import type { Person } from "@/lib/today/types";
import { daysBetween, fmtDdmmyyyy } from "@/lib/today/types";
import { cropPassportPhoto } from "@/lib/today/photoTools";

export type ReportRow = {
  id: string;
  name: string;            // EN
  cn: string;              // 中文
  passportNo: string;
  entry: Date | null;      // entry stamp (or the run day)
  expiry: Date | null;     // new admitted-until
  tag?: string;            // small label under the name, e.g. "ต่อวีซ่า 30 วัน · 延期30天"
  person?: Person;         // when available, the face comes from here
};

export type ReportHeader = {
  title: string;           // big line in the band
  subtitle: string;        // second line (company · date …)
  badge: string;           // small caps on the right, e.g. VISA RUN REPORT
  count: string;           // right side big text
  note: string;            // grey footer line
  urgent?: boolean;        // reminder style: red band instead of amber
};

const FONT = "system-ui, 'Noto Sans Thai', 'Noto Sans SC', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";
export const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
export const zhDate = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
export const thDate = (d: Date) => `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;
// the way the immigration stamp prints it: "7 DEC 2026" — shown next to the
// date so a customer can match the report to the blue stamp in the passport
const EN_MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
export const stampDate = (d: Date) => `${d.getDate()} ${EN_MONTHS[d.getMonth()]} ${d.getFullYear()}`;

const ExpiryReport = forwardRef<HTMLDivElement, { rows: ReportRow[]; header: ReportHeader; today: Date }>(function ExpiryReport({ rows, header, today }, ref) {
  // blue / navy / slate theme; the reminder variant goes deep navy
  const accent = header.urgent ? "#1e3a8a" : "#1d4ed8";
  const accent2 = header.urgent ? "#3b82f6" : "#60a5fa";
  const bg = "linear-gradient(135deg,#dbeafe 0%,#f1f5f9 45%,#e2e8f0 100%)";
  const withPhotos = rows.some((r) => r.person);
  const cols = withPhotos ? "40px 64px 1fr 170px 420px" : "40px 1fr 180px 440px";
  return (
    <div ref={ref} style={{ width: 1000, padding: 22, background: bg, fontFamily: FONT, position: "relative", overflow: "hidden", boxSizing: "border-box" }}>
      <div style={{ position: "absolute", right: -90, top: -90, width: 300, height: 300, borderRadius: "50%", background: accent, opacity: 0.08 }} />
      <div style={{ position: "absolute", right: 120, top: -40, width: 140, height: 140, borderRadius: "50%", background: accent2, opacity: 0.12 }} />
      <div style={{ position: "absolute", left: -70, bottom: -110, width: 260, height: 260, borderRadius: "50%", background: accent, opacity: 0.06 }} />

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: `linear-gradient(90deg, ${accent}, ${header.urgent ? "#1e40af" : "#2563eb"})`, color: "#fff", borderRadius: 16, padding: "14px 22px", boxShadow: "0 6px 18px rgba(30,58,138,.25)", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ width: 54, height: 54, borderRadius: 14, background: "rgba(255,255,255,.18)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 32, lineHeight: 1 }}>{header.urgent ? "⏰" : "📅"}</div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>{header.title}</div>
            <div style={{ fontSize: 13, opacity: 0.9, marginTop: 3 }}>{header.subtitle}</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.85 }}>{header.badge}</div>
          <div style={{ display: "inline-block", marginTop: 4, background: "rgba(255,255,255,.92)", color: accent, borderRadius: 10, padding: "4px 14px", fontSize: 20, fontWeight: 800, lineHeight: 1.2 }}>{header.count}</div>
        </div>
      </div>

      {/* table */}
      <div style={{ background: "rgba(255,255,255,.95)", borderRadius: 16, padding: "10px 14px", marginTop: 12, boxShadow: "0 2px 12px rgba(30,58,138,.08)", position: "relative" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: "0 10px", alignItems: "center", padding: "8px 6px", borderBottom: `2px solid ${accent}`, fontSize: 12, fontWeight: 700, color: "#475569", letterSpacing: 0.3 }}>
          <div>#</div>{withPhotos && <div></div>}<div>ชื่อ · 姓名</div><div>วันเข้าประเทศ · 入境日期</div><div style={{ color: accent }}>วีซ่าหมดอายุ · 签证到期日</div>
        </div>
        {rows.length === 0 && <div style={{ textAlign: "center", color: "#999", padding: 30 }}>ไม่มีรายการ</div>}
        {rows.map((r, i) => {
          const left = r.expiry ? daysBetween(today, r.expiry) : null;
          // the expiry pill keeps a traffic-light meaning: red = overdue / this week, amber = within 2 weeks, blue = fine
          const leftStyle = left === null ? {} : left < 0 ? { background: "#7f1d1d", color: "#fff" } : left <= 7 ? { background: "#dc2626", color: "#fff" } : left <= 14 ? { background: "#fef3c7", color: "#92400e" } : { background: "#dbeafe", color: "#1e3a8a" };
          const leftText = left === null ? "" : left < 0 ? `เกินแล้ว ${-left} วัน · 已逾期 ${-left} 天` : left === 0 ? "หมดวันนี้ · 今天到期" : `เหลืออีก ${left} วัน · 还剩 ${left} 天`;
          return (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: cols, gap: "0 10px", alignItems: "center", padding: "9px 6px", borderBottom: "1px solid #e2e8f0", background: i % 2 ? "#f8fafc" : undefined, borderRadius: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: accent, color: "#fff", fontSize: 13, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 3px rgba(0,0,0,.25)" }}>{i + 1}</div>
              {withPhotos && (r.person ? <RowPhoto person={r.person} /> : <div />)}
              <div>
                <div style={{ fontFamily: "'Courier New', ui-monospace, monospace", fontSize: 18, fontWeight: 700, color: "#0f172a", letterSpacing: 0.3 }}>{r.name || "—"}</div>
                <div style={{ fontSize: 21, color: "#0f172a", lineHeight: 1.15 }}>{r.cn || " "}</div>
                {r.tag && <span style={{ display: "inline-block", marginTop: 3, background: "#e0e7ff", color: "#3730a3", borderRadius: 6, fontSize: 11, fontWeight: 700, padding: "1px 7px" }}>{r.tag}</span>}
              </div>
              <div style={{ fontSize: 14, color: "#1e293b" }}>{r.entry ? <><div style={{ fontWeight: 700, fontSize: 16 }}>{fmtDdmmyyyy(r.entry)}</div><div style={{ fontSize: 12, color: "#64748b" }}>{zhDate(r.entry)}</div></> : "—"}</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                {r.expiry ? (
                  <>
                    <div>
                      <div style={{ display: "inline-block", borderRadius: 10, padding: "4px 12px", fontSize: 21, fontWeight: 800, letterSpacing: 0.5, boxShadow: "0 1px 3px rgba(0,0,0,.15)", ...leftStyle }}>{fmtDdmmyyyy(r.expiry)}</div>
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{zhDate(r.expiry)}</div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
                      {/* stamp look-alike: what the customer will see printed in the passport */}
                      <span style={{ fontFamily: "'Courier New', ui-monospace, monospace", fontSize: 15, fontWeight: 700, color: "#1d4ed8", border: "2px dashed #3b82f6", borderRadius: 6, padding: "2px 8px", background: "#eff6ff", letterSpacing: 1, whiteSpace: "nowrap" }}>🛂 {stampDate(r.expiry)}</span>
                      {leftText && <span style={{ fontSize: 12, fontWeight: 700, color: left !== null && left <= 7 ? "#b91c1c" : "#1e3a8a", background: left !== null && left <= 7 ? "#fee2e2" : "#eff6ff", borderRadius: 8, padding: "3px 8px", whiteSpace: "nowrap" }}>{leftText}</span>}
                    </div>
                  </>
                ) : "—"}
              </div>
            </div>
          );
        })}
      </div>

      {/* footer */}
      <div style={{ marginTop: 12, padding: "10px 14px", position: "relative", background: "rgba(255,255,255,.7)", borderRadius: 12, borderLeft: `4px solid ${accent}`, fontSize: 12, color: "#1e293b", lineHeight: 1.45 }}>
        <div>⚠️ กรุณาออกนอกประเทศหรือต่อวีซ่า<b>ก่อน</b>วันหมดอายุ — อยู่เกินปรับวันละ 500 บาท และมีผลต่อการเข้าประเทศครั้งต่อไป</div>
        <div style={{ color: "#1e3a8a" }}>⚠️ 请在到期日<b>之前</b>出境或办理延期 — 逾期每天罚款 500 泰铢，并影响下次入境</div>
        {rows.some((r) => r.expiry) && (
          <div style={{ marginTop: 4, color: "#1d4ed8", fontWeight: 700 }}>
            🛂 กรอบเส้นประ = วันที่ตามตราปั๊มในพาสปอร์ต (วัน เดือนอังกฤษ ปี ค.ศ.) · 虚线框 = 护照上蓝色印章的日期写法（日 英文月份 年）
            {" · "}
            {Array.from(new Set(rows.filter((r) => r.expiry).map((r) => (r.expiry as Date).getMonth()))).sort((a, b) => a - b).map((m) => `${EN_MONTHS[m]} = ${m + 1}月`).join(" · ")}
          </div>
        )}
        {header.note && <div style={{ color: "#64748b", marginTop: 2 }}>{header.note}</div>}
      </div>
    </div>
  );
});
export default ExpiryReport;

function RowPhoto({ person: p }: { person: Person }) {
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
  const box: React.CSSProperties = { width: 54, height: 70, objectFit: "cover", borderRadius: 6, background: "#eee", display: "inline-block", boxShadow: "0 1px 3px rgba(0,0,0,.25)" };
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" style={box} /> : <div style={box} />;
}
