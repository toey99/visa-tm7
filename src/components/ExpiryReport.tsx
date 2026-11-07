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

const ExpiryReport = forwardRef<HTMLDivElement, { rows: ReportRow[]; header: ReportHeader; today: Date }>(function ExpiryReport({ rows, header, today }, ref) {
  const accent = header.urgent ? "#b91c1c" : "#b45309";
  const bg = header.urgent ? "linear-gradient(135deg,#fef2f2,#fff7ed 45%,#fee2e2)" : "linear-gradient(135deg,#fff7ed,#fffbeb 45%,#fef3c7)";
  const withPhotos = rows.some((r) => r.person);
  const cols = withPhotos ? "36px 64px 1fr 150px 150px 200px" : "36px 1fr 160px 160px 210px";
  return (
    <div ref={ref} style={{ width: 1000, padding: 22, background: bg, fontFamily: FONT, position: "relative", overflow: "hidden", boxSizing: "border-box" }}>
      <div style={{ position: "absolute", right: -90, top: -90, width: 300, height: 300, borderRadius: "50%", background: accent, opacity: 0.07 }} />

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: accent, color: "#fff", borderRadius: 16, padding: "12px 20px", boxShadow: "0 4px 14px rgba(0,0,0,.18)", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 38, lineHeight: 1 }}>{header.urgent ? "⏰" : "📅"}</div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>{header.title}</div>
            <div style={{ fontSize: 13, opacity: 0.9, marginTop: 3 }}>{header.subtitle}</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.85 }}>{header.badge}</div>
          <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2 }}>{header.count}</div>
        </div>
      </div>

      {/* table */}
      <div style={{ background: "rgba(255,255,255,.94)", borderRadius: 16, padding: "10px 14px", marginTop: 12, boxShadow: "0 2px 10px rgba(0,0,0,.06)", position: "relative" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, gap: "0 10px", alignItems: "center", padding: "6px 4px", borderBottom: `2px solid ${accent}`, fontSize: 12, fontWeight: 700, color: "#555" }}>
          <div>#</div>{withPhotos && <div></div>}<div>ชื่อ · 姓名</div><div>เลขพาสปอร์ต · 护照号</div><div>วันเข้าประเทศ · 入境日期</div><div style={{ color: "#b91c1c" }}>วีซ่าหมดอายุ · 签证到期日</div>
        </div>
        {rows.length === 0 && <div style={{ textAlign: "center", color: "#999", padding: 30 }}>ไม่มีรายการ</div>}
        {rows.map((r, i) => {
          const left = r.expiry ? daysBetween(today, r.expiry) : null;
          const leftStyle = left === null ? {} : left < 0 ? { background: "#7f1d1d", color: "#fff" } : left <= 7 ? { background: "#dc2626", color: "#fff" } : left <= 14 ? { background: "#fee2e2", color: "#991b1b" } : { background: "#fef3c7", color: "#78350f" };
          return (
            <div key={r.id} style={{ display: "grid", gridTemplateColumns: cols, gap: "0 10px", alignItems: "center", padding: "8px 4px", borderBottom: "1px solid #eee", background: i % 2 ? "rgba(254,243,199,.35)" : undefined }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: accent, color: "#fff", fontSize: 13, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</div>
              {withPhotos && (r.person ? <RowPhoto person={r.person} /> : <div />)}
              <div>
                <div style={{ fontFamily: "'Courier New', ui-monospace, monospace", fontSize: 17, fontWeight: 700, color: "#111", letterSpacing: 0.3 }}>{r.name || "—"}</div>
                <div style={{ fontSize: 20, color: "#111", lineHeight: 1.15 }}>{r.cn || " "}</div>
                {r.tag && <span style={{ display: "inline-block", marginTop: 2, background: "#ffedd5", color: "#9a3412", borderRadius: 6, fontSize: 11, fontWeight: 700, padding: "1px 6px" }}>{r.tag}</span>}
              </div>
              <div style={{ fontFamily: "'Courier New', ui-monospace, monospace", fontSize: 17, fontWeight: 700, color: "#111" }}>{r.passportNo || "—"}</div>
              <div style={{ fontSize: 14, color: "#222" }}>{r.entry ? <><div style={{ fontWeight: 700 }}>{fmtDdmmyyyy(r.entry)}</div><div style={{ fontSize: 12, color: "#555" }}>{zhDate(r.entry)}</div></> : "—"}</div>
              <div>
                {r.expiry ? (
                  <>
                    <div style={{ display: "inline-block", borderRadius: 8, padding: "3px 10px", fontSize: 20, fontWeight: 800, letterSpacing: 0.5, ...leftStyle }}>{fmtDdmmyyyy(r.expiry)}</div>
                    <div style={{ fontSize: 12, color: "#7f1d1d", marginTop: 2 }}>
                      {zhDate(r.expiry)}
                      {left !== null && (left < 0 ? ` · เกินแล้ว ${-left} วัน · 已逾期 ${-left} 天` : left === 0 ? " · หมดวันนี้ · 今天到期" : ` · เหลืออีก ${left} วัน · 还剩 ${left} 天`)}
                    </div>
                  </>
                ) : "—"}
              </div>
            </div>
          );
        })}
      </div>

      {/* footer */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginTop: 12, padding: "0 6px", position: "relative", gap: 16 }}>
        <div style={{ fontSize: 12, color: "#444", lineHeight: 1.4 }}>
          <div>⚠️ กรุณาออกนอกประเทศหรือต่อวีซ่า<b>ก่อน</b>วันหมดอายุ — อยู่เกินปรับวันละ 500 บาท และมีผลต่อการเข้าประเทศครั้งต่อไป</div>
          <div style={{ color: "#1e3a8a" }}>⚠️ 请在到期日<b>之前</b>出境或办理延期 — 逾期每天罚款 500 泰铢，并影响下次入境</div>
          {header.note && <div style={{ color: "#777", marginTop: 2 }}>{header.note}</div>}
        </div>
        <div style={{ textAlign: "right", lineHeight: 1.25, flexShrink: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: accent }}>ABC · Alliance Border Consulting</div>
          <div style={{ fontSize: 11, color: "#555" }}>诚信经营 · 用心服务 · ซื่อสัตย์ จริงใจ ใส่ใจบริการ</div>
        </div>
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
