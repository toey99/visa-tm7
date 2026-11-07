"use client";

// =============================================================
// ExpiryReport — evening "visa expiry" infographic for the visa-run board
// =============================================================
// For the factory / agent that sends groups of workers: one picture listing
// everyone ticked "report" with name (EN / 中文), passport no., the re-entry
// date (the run day) and the new expiry date, so neither the worker nor
// the company misses it. Exported with html-to-image like the other sheets.

import { forwardRef, useEffect, useState } from "react";
import type { DayMeta, Person } from "@/lib/today/types";
import { daysBetween, extensionExpiry, fmtDdmmyyyy, parseDdmmyyyy, runExpiry } from "@/lib/today/types";
import { OFFICES } from "@/lib/offices";
import { cropPassportPhoto } from "@/lib/today/photoTools";

const FONT = "system-ui, 'Noto Sans Thai', 'Noto Sans SC', 'Segoe UI Emoji', 'Apple Color Emoji', sans-serif";
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const zhDate = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
const thDate = (d: Date) => `${d.getDate()} ${TH_MONTHS[d.getMonth()]} ${d.getFullYear() + 543}`;

// mode "run": entry = the run day, expiry = run + visa days (+30 for run+30).
// mode "ext": entry = the arrival stamp, expiry = admitted-until + extension days.
const ExpiryReport = forwardRef<HTMLDivElement, { people: Person[]; meta: DayMeta; company: string; mode: "ext" | "run" }>(function ExpiryReport({ people, meta, company, mode }, ref) {
  const run = parseDdmmyyyy(meta.date);
  const isRun = mode === "run";
  const accent = "#b45309";
  const office = OFFICES[meta.office];
  return (
    <div ref={ref} style={{ width: 1000, padding: 22, background: "linear-gradient(135deg,#fff7ed,#fffbeb 45%,#fef3c7)", fontFamily: FONT, position: "relative", overflow: "hidden", boxSizing: "border-box" }}>
      <div style={{ position: "absolute", right: -90, top: -90, width: 300, height: 300, borderRadius: "50%", background: accent, opacity: 0.07 }} />

      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: accent, color: "#fff", borderRadius: 16, padding: "12px 20px", boxShadow: "0 4px 14px rgba(0,0,0,.18)", position: "relative" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div style={{ fontSize: 38, lineHeight: 1 }}>📅</div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.1 }}>สรุปวันหมดอายุวีซ่า · 签证到期日汇总</div>
            <div style={{ fontSize: 13, opacity: 0.9, marginTop: 3 }}>{company ? `${company} · ` : ""}{isRun ? `วีซ่ารัน ${run ? thDate(run) : meta.date} · 过境日期 ${run ? zhDate(run) : meta.date}` : `ต่อวีซ่า ${meta.extensionDays || 30} วัน ${office.label} ${run ? thDate(run) : meta.date} · 延期${meta.extensionDays || 30}天 ${run ? zhDate(run) : meta.date}`}</div>
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 11, letterSpacing: 2, opacity: 0.85 }}>{isRun ? "VISA RUN REPORT" : "VISA EXTENSION REPORT"}</div>
          <div style={{ fontSize: 22, fontWeight: 800, lineHeight: 1.2 }}>👥 {people.length} คน · {people.length} 人</div>
        </div>
      </div>

      {/* table */}
      <div style={{ background: "rgba(255,255,255,.94)", borderRadius: 16, padding: "10px 14px", marginTop: 12, boxShadow: "0 2px 10px rgba(0,0,0,.06)", position: "relative" }}>
        <div style={{ display: "grid", gridTemplateColumns: "36px 64px 1fr 150px 150px 190px", gap: "0 10px", alignItems: "center", padding: "6px 4px", borderBottom: `2px solid ${accent}`, fontSize: 12, fontWeight: 700, color: "#555" }}>
          <div>#</div><div></div><div>ชื่อ · 姓名</div><div>เลขพาสปอร์ต · 护照号</div><div>วันเข้าประเทศ · 入境日期</div><div style={{ color: "#b91c1c" }}>วีซ่าหมดอายุ · 签证到期日</div>
        </div>
        {people.length === 0 && <div style={{ textAlign: "center", color: "#999", padding: 30 }}>ยังไม่ได้ติ๊กใครเข้าสรุป</div>}
        {people.map((p, i) => {
          const f = p.fields;
          const entry = isRun ? run : parseDdmmyyyy(f.arrivalDate);
          const exp = isRun ? runExpiry(meta.date, f.visaType, f.run || "RUN", f.newUntil) : extensionExpiry(f.arrivalDate, f.admittedUntil, f.visaType, meta.extensionDays, f.newUntil);
          const stay = run && exp ? daysBetween(run, exp) : null;   // days left counted from today
          return (
            <div key={p.id} style={{ display: "grid", gridTemplateColumns: "36px 64px 1fr 150px 150px 190px", gap: "0 10px", alignItems: "center", padding: "8px 4px", borderBottom: "1px solid #eee", background: i % 2 ? "rgba(254,243,199,.35)" : undefined }}>
              <div style={{ width: 26, height: 26, borderRadius: "50%", background: accent, color: "#fff", fontSize: 13, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</div>
              <RowPhoto person={p} />
              <div>
                <div style={{ fontFamily: "'Courier New', ui-monospace, monospace", fontSize: 17, fontWeight: 700, color: "#111", letterSpacing: 0.3 }}>{[f.firstName, f.lastName].filter(Boolean).join(" ") || "—"}</div>
                <div style={{ fontSize: 20, color: "#111", lineHeight: 1.15 }}>{f.chineseName || " "}</div>
                {isRun && f.run === "RUN30" && <span style={{ display: "inline-block", marginTop: 2, background: "#ffedd5", color: "#9a3412", borderRadius: 6, fontSize: 11, fontWeight: 700, padding: "1px 6px" }}>วีซ่ารัน + ต่อ 30 วัน · 过境+延期30天</span>}
                {!isRun && <span style={{ display: "inline-block", marginTop: 2, background: "#ffedd5", color: "#9a3412", borderRadius: 6, fontSize: 11, fontWeight: 700, padding: "1px 6px" }}>ต่อวีซ่า {meta.extensionDays || 30} วัน · 延期{meta.extensionDays || 30}天</span>}
              </div>
              <div style={{ fontFamily: "'Courier New', ui-monospace, monospace", fontSize: 17, fontWeight: 700, color: "#111" }}>{f.passportNo || "—"}</div>
              <div style={{ fontSize: 14, color: "#222" }}>{entry ? <><div style={{ fontWeight: 700 }}>{fmtDdmmyyyy(entry)}</div><div style={{ fontSize: 12, color: "#555" }}>{zhDate(entry)}</div></> : "—"}</div>
              <div>
                {exp ? (
                  <>
                    <div style={{ display: "inline-block", background: "#fee2e2", color: "#991b1b", borderRadius: 8, padding: "3px 10px", fontSize: 20, fontWeight: 800, letterSpacing: 0.5 }}>{fmtDdmmyyyy(exp)}</div>
                    <div style={{ fontSize: 12, color: "#7f1d1d", marginTop: 2 }}>{zhDate(exp)}{stay !== null ? ` · เหลืออีก ${stay} วัน · 还剩 ${stay} 天` : ""}</div>
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
          <div style={{ color: "#777", marginTop: 2 }}>{isRun ? "วันหมดอายุคำนวณจากตราเข้าเมืองวันนี้ กรุณาตรวจกับตราในพาสปอร์ตอีกครั้ง · 到期日按今日入境章计算，请再次核对护照上的印章" : "วันหมดอายุคำนวณจากตราต่อวีซ่าวันนี้ กรุณาตรวจกับตราในพาสปอร์ตอีกครั้ง · 到期日按今日延期章计算，请再次核对护照上的印章"}</div>
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
