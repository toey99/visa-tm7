// =============================================================
// Summary sheet rendered on the server (for LINE) — next/og (satori)
// =============================================================
// The board's own summary is drawn in the browser (SummarySheet in
// DayBoard.tsx) and captured with html-to-image. The LINE bot has no browser,
// so this draws the same sheet — header band, numbered photo cards with the
// payment pill, footer totals — with satori and returns a PNG. Satori only
// knows flexbox and needs every glyph in a font it was given: Sarabun covers
// Thai + Latin (public/fonts, with a bolder cut fetched from Google Fonts),
// Chinese names come from a Noto Sans SC subset fetched for exactly the
// characters on the sheet, emoji are drawn as Twemoji by next/og.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CSSProperties } from "react";
import { ImageResponse } from "next/og";
import { blobGetByPath } from "@/lib/blob";
import { boardFolder, loadManifest, readRecords, type PersonRec } from "@/lib/day-server";
import { OFFICES, type OfficeId } from "@/lib/offices";
import { overstayInfo, type PersonFields } from "@/lib/today/types";
import { carById, RUN_SLOTS } from "@/lib/visarun/cars";

export type SummaryTarget = { ns: "days" | "run"; office: OfficeId };

type Font = { name: string; data: ArrayBuffer; weight: 400 | 700; style: "normal" };
const fontCache = new Map<string, Promise<ArrayBuffer | null>>();

// Google Fonts hands out a TTF subset for exactly `text` when asked with an old user agent
async function googleFont(family: string, weight: 400 | 700, text: string): Promise<ArrayBuffer | null> {
  const chars = [...new Set(text)].join("");
  const key = `${family}:${weight}:${chars}`;
  if (!fontCache.has(key)) {
    fontCache.set(key, (async () => {
      try {
        const css = await fetch(`https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${weight}&text=${encodeURIComponent(chars)}`, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1; WOW64; rv:27.0) Gecko/20100101 Firefox/27.0" },
        }).then((r) => (r.ok ? r.text() : ""));
        const m = css.match(/src:\s*url\(([^)]+)\)\s*format\(['"](?:truetype|opentype)['"]\)/);
        if (!m) return null;
        const r = await fetch(m[1]);
        return r.ok ? r.arrayBuffer() : null;
      } catch { return null; }
    })());
  }
  return fontCache.get(key)!;
}

let sarabunLocal: Promise<ArrayBuffer | null> | null = null;
const localSarabun = () => (sarabunLocal ??= readFile(path.join(process.cwd(), "public", "fonts", "Sarabun-Regular.ttf")).then((b) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer).catch(() => null));

async function loadFonts(text: string): Promise<Font[]> {
  const cjk = text.replace(/[^㐀-鿿豈-﫿]/g, "");
  const [thai400, thai700, sc, local] = await Promise.all([
    googleFont("Sarabun", 400, text), googleFont("Sarabun", 700, text),
    cjk ? googleFont("Noto Sans SC", 400, cjk) : Promise.resolve(null),
    localSarabun(),
  ]);
  const fonts: Font[] = [];
  const base = thai400 ?? local;
  if (base) fonts.push({ name: "Sarabun", data: base, weight: 400, style: "normal" });
  if (thai700) fonts.push({ name: "Sarabun", data: thai700, weight: 700, style: "normal" });
  if (sc) fonts.push({ name: "Noto Sans SC", data: sc, weight: 400, style: "normal" });
  return fonts;
}

async function photoDataUrl(p: PersonRec): Promise<string> {
  const files = (p.files as { kind?: string; path?: string; mime?: string }[] | undefined) ?? [];
  const cand = [typeof p.photo === "string" ? p.photo : "", files.find((f) => f.kind === "selfie")?.path, files.find((f) => f.kind === "passport")?.path].filter((x): x is string => !!x);
  for (const src of cand) {
    const r = await blobGetByPath(src, false).catch(() => null);
    if (!r || !r.ok) continue;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) continue;
    const mime = r.headers.get("content-type") || "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  }
  return "";
}

const pill = (bg: string, fg: string, size = 11): CSSProperties => ({ display: "flex", background: bg, color: fg, borderRadius: 999, padding: "2px 8px", fontSize: size, fontWeight: 700, lineHeight: 1.3, textAlign: "center" });

export type RenderedSummary = { png: ArrayBuffer; count: number; agent: string; date: string };

/** Draw the summary of one board (optionally one agent's people) as a PNG. */
export async function renderSummaryPng(target: SummaryTarget, dayKey: string, agent = ""): Promise<RenderedSummary> {
  const folder = boardFolder(target.ns, dayKey, target.office);
  const m = await loadManifest(target.ns, dayKey, target.office, folder);
  const recs = m ? (await readRecords(folder, Object.keys(m.entries))).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)) : [];
  const meta = (m?.meta ?? {}) as Partial<{ extensionDays: string; slot: string; flight: string; landTime: string; returnBy: string }>;
  const date = `${dayKey.slice(0, 2)}/${dayKey.slice(2, 4)}/${dayKey.slice(4)}`;
  const want = agent.trim().toLowerCase();
  const shown = want ? recs.filter((p) => String((p.fields as Partial<PersonFields>)?.agent ?? "").trim().toLowerCase() === want) : recs;
  const people = shown.filter((p) => !p.cancelled && !p.movedTo);
  const o = OFFICES[target.office];
  const isRun = target.ns === "run";
  const accent = o.summaryAccent;

  const [dd, mm, yy] = date.split("/");
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const thDays = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
  const cnDays = ["日", "一", "二", "三", "四", "五", "六"];
  const dateObj = new Date(Number(yy), Number(mm) - 1, Number(dd));
  const dateEn = `${dd} ${months[Number(mm) - 1] ?? mm} ${yy}`;
  const dateTh = `วัน${thDays[dateObj.getDay()]}ที่ ${Number(dd)}`;
  const dateCn = `${yy}年${Number(mm)}月${Number(dd)}日 · 星期${cnDays[dateObj.getDay()]}`;
  const runSlot = RUN_SLOTS.find((s) => s.id === (meta.slot || "morning"));

  const F = (p: PersonRec) => (p.fields ?? {}) as Partial<PersonFields>;
  const num = (v: unknown) => Number(v) || 0;
  const collect = people.filter((p) => F(p).pay === "collect");
  const sum = collect.reduce((s, p) => s + num(F(p).amount), 0);
  const received = collect.reduce((s, p) => s + ((F(p).paidHow === "cash" || F(p).paidHow === "transfer") ? num(F(p).paidAmount || F(p).amount) : 0), 0);
  const pendingN = collect.filter((p) => (F(p).paidHow ?? "pending") === "pending").length;
  const waiting = collect.filter((p) => F(p).paidHow === "waiting");
  const overstays = people.filter((p) => (overstayInfo(F(p).arrivalDate ?? "", F(p).admittedUntil ?? "", F(p).visaType ?? "", date, undefined, !isRun)?.days ?? 0) > 0).length;

  const cols = shown.length <= 6 ? 6 : 8;
  const sheetW = cols === 8 ? 1040 : 900;
  const cardW = Math.floor((sheetW - 44 - 32 - (cols - 1) * 10) / cols);

  const cards = await Promise.all(shown.map(async (p, i) => {
    const f = F(p);
    const ghost = !!(p.cancelled || p.movedTo);
    const amt = f.amount ? ` ${num(f.amount).toLocaleString()}` : "";
    const who = want ? (f.subAgent ? `${f.subAgent} ` : "") : (f.agent ? `${f.agent} ` : "");
    const got = f.paidAmount || f.amount ? ` ${num(f.paidAmount || f.amount).toLocaleString()}` : "";
    const tag = p.cancelled ? { bg: "#fee2e2", fg: "#991b1b", t: "❌ ไม่มา" }
      : p.movedTo ? { bg: "#dbeafe", fg: "#1e3a8a", t: `➡ เลื่อนไป ${String(p.movedTo).slice(0, 5)}` }
      : f.pay === "collect"
        ? (f.paidHow === "cash" ? { bg: "#d2f4dd", fg: "#14532d", t: `💵 ${who}รับเงินสดแล้ว${got}` }
          : f.paidHow === "transfer" ? { bg: "#cfe9ff", fg: "#0b3d6b", t: `📲 ${who}โอนแล้ว${got}` }
          : f.paidHow === "waiting" ? { bg: "#ede9fe", fg: "#4c1d95", t: `🕓 ${who}รอโอน${amt}`.trim() }
          : f.paidHow === "agent" ? { bg: "#cfe9ff", fg: "#0b3d6b", t: `🏢 ${who}จ่ายที่เอเจนซี่` }
          : { bg: "#ffe66d", fg: "#4a3b00", t: `💰 ${who}เก็บ${amt}`.trim() })
        : f.pay === "paid" ? { bg: "#d2f4dd", fg: "#14532d", t: `✅ ${who}จ่ายแล้ว` }
        : f.pay === "hold" ? { bg: "#7c3aed", fg: "#ffffff", t: `🔒 ${who}รอโอน · hold พาส` } : { bg: "#dbeafe", fg: "#1e3a8a", t: `🤝 ${who}ไม่เก็บ` };
    const ov = overstayInfo(f.arrivalDate ?? "", f.admittedUntil ?? "", f.visaType ?? "", date, undefined, !isRun);
    const car = isRun ? carById(f.car) : undefined;
    return { p, f, i, ghost, tag, ov, car, img: await photoDataUrl(p), cancelled: !!p.cancelled, moved: p.movedTo ? String(p.movedTo) : "", arrived: !!p.arrived };
  }));

  const text = [
    o.summaryTitle, o.subtitle, dateEn, dateTh, dateCn, agent, "VISA RUN ISSUE DATE รอบ ลง กลับถึงสนามบินก่อน ต่อวีซ่า วัน คน มาแล้ว ต้องเก็บ รวม บาท รอโอน hold พาสปอร์ต รอเอเจนซี่ยืนยันโอน รับแล้ว ไม่มีรายการเก็บเงิน overstay VIP คัน ไปต่อ 30 ไม่มา เลื่อนวัน ยังไม่มีลูกค้า 诚信经营 · 用心服务 ซื่อสัตย์ จริงใจ ใส่ใจบริการ Integrity in Business, Care in Service 0123456789,.+/·↳➡✓",
    runSlot?.th ?? "", meta.flight ?? "", meta.landTime ?? "", meta.returnBy ?? "", meta.extensionDays ?? "",
    ...cards.flatMap((c) => [c.f.lastName ?? "", c.f.firstName ?? "", c.f.chineseName ?? "", c.f.subAgent ?? "", c.f.note ?? "", c.tag.t, c.car?.id ?? ""]),
  ].join("");
  const fonts = await loadFonts(text);
  const font = "Sarabun, 'Noto Sans SC'";

  const header = isRun ? `🚗 VISA RUN · ${o.summaryTitle}` : o.summaryTitle;
  const sub = isRun
    ? `รอบ${runSlot?.th ?? ""}${meta.flight ? ` · ✈ ${meta.flight}` : ""}${meta.landTime ? ` ลง ${meta.landTime}` : ""}${meta.returnBy ? ` · กลับถึงสนามบินก่อน ${meta.returnBy}` : ""}`
    : `${o.subtitle}${o.generator !== "none" ? ` · ต่อวีซ่า ${meta.extensionDays || "30"} วัน` : ""}`;

  // the sheet grows with its rows; satori needs a fixed height, so estimate it
  const rows = Math.max(1, Math.ceil(shown.length / cols));
  const height = 22 + 70 + 12 + 32 + rows * 212 + 14 + 12 + 70 + 22;

  const element = (
    <div style={{ display: "flex", flexDirection: "column", width: sheetW, height, padding: 22, background: o.summaryBg, fontFamily: font, position: "relative" }}>
      <div style={{ position: "absolute", right: -60, top: -60, width: 220, height: 220, borderRadius: 110, background: accent, opacity: 0.08, display: "flex" }} />
      <div style={{ position: "absolute", left: -40, bottom: -70, width: 180, height: 180, borderRadius: 90, background: accent, opacity: 0.06, display: "flex" }} />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: accent, color: "#fff", borderRadius: 14, padding: "12px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", fontSize: 34, lineHeight: 1 }}>{o.emoji}</div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>
              <span>{header}</span>
              {agent ? <span style={{ display: "flex", fontSize: 15, fontWeight: 700, background: "rgba(255,255,255,.22)", borderRadius: 8, padding: "2px 10px" }}>🏢 {agent}</span> : null}
            </div>
            <div style={{ display: "flex", fontSize: 12, opacity: 0.9, marginTop: 3 }}>{sub}</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
          <div style={{ display: "flex", fontSize: 11, letterSpacing: 2, opacity: 0.85 }}>📅 ISSUE DATE</div>
          <div style={{ display: "flex", fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>{dateEn}</div>
          <div style={{ display: "flex", fontSize: 12, opacity: 0.95 }}>{dateTh} · {dateCn}</div>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", alignContent: "flex-start", gap: "16px 10px", background: "rgba(255,255,255,.92)", borderRadius: 14, padding: "18px 16px 14px", marginTop: 12, flexGrow: 1 }}>
        {cards.length === 0 && <div style={{ display: "flex", width: "100%", justifyContent: "center", color: "#999", padding: 30 }}>ยังไม่มีลูกค้า</div>}
        {cards.map(({ p, f, i, ghost, tag, ov, car, img, cancelled, moved, arrived }) => (
          <div key={p.id} style={{ display: "flex", flexDirection: "column", alignItems: "center", width: cardW, opacity: ghost ? 0.75 : 1 }}>
            <div style={{ display: "flex", position: "relative", width: 90, height: 120 }}>
              {img
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={img} alt="" width={90} height={120} style={{ width: 90, height: 120, objectFit: "cover", borderRadius: 4, filter: ghost ? "grayscale(1)" : undefined }} />
                : <div style={{ display: "flex", width: 90, height: 120, background: "#eee", borderRadius: 4 }} />}
              {cancelled && <div style={{ position: "absolute", left: 0, top: 0, width: 90, height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: "#dc2626", fontSize: 64, fontWeight: 700 }}>✕</div>}
              {!!moved && <div style={{ position: "absolute", left: 0, top: 0, width: 90, height: 120, display: "flex", alignItems: "center", justifyContent: "center", color: "#2563eb", fontSize: 56, fontWeight: 700 }}>➡</div>}
              <div style={{ position: "absolute", top: -6, left: -6, width: 22, height: 22, borderRadius: 11, background: accent, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</div>
              {!!ov && ov.days > 0 && <div style={{ position: "absolute", bottom: -6, right: -6, display: "flex", background: "#dc2626", color: "#fff", borderRadius: 6, fontSize: 10, fontWeight: 700, padding: "2px 5px" }}>⚠ +{ov.days}</div>}
              {!!car && <div style={{ position: "absolute", top: -6, right: -6, display: "flex", background: car.accent, color: "#fff", borderRadius: 6, fontSize: 10, fontWeight: 700, padding: "2px 5px" }}>🚗{car.id}</div>}
              {!!f.vip && <div style={{ position: "absolute", top: isRun ? 70 : -10, right: -10, display: "flex", fontSize: 26, lineHeight: 1 }}>👑</div>}
              {isRun && !!f.cambodia && <div style={{ position: "absolute", top: 18, right: -8, display: "flex", fontSize: 22, lineHeight: 1 }}>🐻</div>}
              {isRun && !!f.overstay && <div style={{ position: "absolute", top: 44, right: -8, display: "flex", fontSize: 22, lineHeight: 1 }}>🐢</div>}
              {isRun && f.run === "RUN30" && <div style={{ position: "absolute", bottom: -6, left: -6, display: "flex", background: "#ea580c", color: "#fff", borderRadius: 6, fontSize: 10, fontWeight: 700, padding: "2px 5px" }}>+30</div>}
              {arrived && <div style={{ position: "absolute", right: -8, bottom: 10, width: 34, height: 34, borderRadius: 17, background: "#16a34a", border: "3px solid #fff", color: "#fff", fontSize: 20, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>✓</div>}
            </div>
            <div style={{ display: "flex", fontSize: 10, fontWeight: 700, marginTop: 6, color: "#222", textAlign: "center" }}>{[f.lastName, f.firstName].filter(Boolean).join(" ") || " "}</div>
            <div style={{ display: "flex", fontSize: 15, lineHeight: 1.2, color: "#111" }}>{f.chineseName || " "}</div>
            {f.subAgent ? <div style={{ display: "flex", fontSize: 10, color: "#4338ca", fontWeight: 700, marginTop: 2 }}>↳ {f.subAgent}</div> : null}
            <div style={{ display: "flex", marginTop: 5, maxWidth: cardW }}><div style={pill(tag.bg, tag.fg, 11)}>{tag.t}</div></div>
            {f.note ? <div style={{ display: "flex", fontSize: 10, color: "#666", marginTop: 3 }}>📝 {f.note}</div> : null}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, padding: "0 6px", fontSize: 13, color: "#333" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <div style={pill("#fff", accent, 13)}>👥 {people.length} คน</div>
          {people.some((p) => !!p.arrived) && <div style={pill("#16a34a", "#fff", 13)}>✓ มาแล้ว {people.filter((p) => p.arrived).length}/{people.length}</div>}
          {pendingN > 0 && <div style={pill("#ffe66d", "#4a3b00", 13)}>💰 ต้องเก็บ {pendingN} คน รวม {sum.toLocaleString()} บาท</div>}
          {waiting.length > 0 && <div style={pill("#ede9fe", "#4c1d95", 13)}>🕓 รอโอน {waiting.length} คน {waiting.reduce((s, p) => s + num(F(p).amount), 0).toLocaleString()} บาท</div>}
          {people.some((p) => F(p).pay === "hold") && <div style={pill("#7c3aed", "#ffffff", 13)}>🔒 hold พาสปอร์ต {people.filter((p) => F(p).pay === "hold").length} คน — รอเอเจนซี่ยืนยันโอน</div>}
          {received > 0 && <div style={pill("#d2f4dd", "#14532d", 13)}>💵 รับแล้ว {received.toLocaleString()} บาท</div>}
          {collect.length === 0 && people.length > 0 && <div style={pill("#d2f4dd", "#14532d", 13)}>✅ ไม่มีรายการเก็บเงิน</div>}
          {overstays > 0 && <div style={pill("#fee2e2", "#991b1b", 13)}>⚠ overstay {overstays} คน</div>}
          {people.some((p) => !!F(p).vip) && <div style={pill("#fde047", "#713f12", 13)}>👑 VIP {people.filter((p) => F(p).vip).length} คน · +{(people.filter((p) => F(p).vip).length * 500).toLocaleString()} บาท</div>}
          {isRun && people.some((p) => F(p).run === "RUN30") && <div style={pill("#ffedd5", "#9a3412", 13)}>📄 ไปต่อ 30 วัน {people.filter((p) => F(p).run === "RUN30").length}</div>}
          {shown.some((p) => !!p.cancelled) && <div style={pill("#fee2e2", "#991b1b", 13)}>❌ ไม่มา {shown.filter((p) => p.cancelled).length}</div>}
          {shown.some((p) => !!p.movedTo) && <div style={pill("#dbeafe", "#1e3a8a", 13)}>➡ เลื่อนวัน {shown.filter((p) => p.movedTo).length}</div>}
        </div>
        {/อาเต่า/.test(agent) && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.25 }}>
            <div style={{ display: "flex", fontSize: 14, fontWeight: 700, color: accent }}>诚信经营 · 用心服务</div>
            <div style={{ display: "flex", fontSize: 11, color: "#444" }}>ซื่อสัตย์ จริงใจ ใส่ใจบริการ</div>
            <div style={{ display: "flex", fontSize: 10, color: "#555" }}>Integrity in Business, Care in Service</div>
          </div>
        )}
      </div>
    </div>
  );

  const res = new ImageResponse(element, { width: sheetW, height, fonts: fonts.length ? fonts : undefined, emoji: "twemoji" });
  return { png: await res.arrayBuffer(), count: people.length, agent, date };
}
