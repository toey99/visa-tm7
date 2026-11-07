"use client";

// =============================================================
// /expiry — ⏰ ใกล้หมดอายุ: who needs a run or an extension soon
// =============================================================
// Reads the expiry ledger (one record per passport, written by the day
// boards when the expiry report is exported or "บันทึกทะเบียน" is pressed),
// groups by factory / agent, and makes a reminder picture + a LINE message
// for each group so the company can book the next run before anyone
// overstays.

import { useEffect, useMemo, useRef, useState } from "react";
import ExpiryReport, { thDate, zhDate, type ReportRow } from "@/components/ExpiryReport";
import { daysBetween, fmtDdmmyyyy, parseDdmmyyyy } from "@/lib/today/types";
import { OFFICES, type OfficeId } from "@/lib/offices";
import { downloadBlob, loadScript } from "@/lib/today/clientTools";

type Rec = { passportNo: string; name: string; cn: string; agent: string; phone?: string; kind: "run" | "run30" | "ext"; office: string; jobDate: string; entry: string; expiry: string; updatedAt: string };

const KIND_LABEL: Record<Rec["kind"], string> = { run: "วีซ่ารัน", run30: "วีซ่ารัน + ต่อ 30", ext: "ต่อวีซ่า" };
const WINDOWS = [7, 14, 30, 60, 9999] as const;

export default function ExpiryPage() {
  const [records, setRecords] = useState<Rec[] | null>(null);
  const [error, setError] = useState("");
  const [win, setWin] = useState<number>(14);
  const [q, setQ] = useState("");
  const [agent, setAgent] = useState("");
  const [status, setStatus] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const today = useMemo(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }, []);

  async function load() {
    setError("");
    try {
      const r = await fetch("/api/expiry", { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({ error: `HTTP ${r.status}` }))).error);
      setRecords(((await r.json()) as { records: Rec[] }).records);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setRecords([]); }
  }
  useEffect(() => { void load(); }, []);

  const withLeft = (records ?? []).map((r) => { const d = parseDdmmyyyy(r.expiry); return { ...r, d, left: d ? daysBetween(today, d) : 9999 }; });
  const agents = Array.from(new Set(withLeft.map((r) => r.agent || "(ไม่ระบุ)"))).sort();
  const shown = withLeft
    .filter((r) => r.left <= win)
    .filter((r) => !agent || (r.agent || "(ไม่ระบุ)") === agent)
    .filter((r) => !q || `${r.name} ${r.cn} ${r.passportNo} ${r.agent}`.toUpperCase().includes(q.toUpperCase()))
    .sort((a, b) => a.left - b.left);
  const groups = (() => { const m = new Map<string, typeof shown>(); for (const r of shown) { const k = r.agent || "(ไม่ระบุ)"; m.set(k, [...(m.get(k) ?? []), r]); } return [...m.entries()]; })();
  const overdue = withLeft.filter((r) => r.left < 0).length;
  const week = withLeft.filter((r) => r.left >= 0 && r.left <= 7).length;

  // picture: the currently shown rows (one agent at a time is the normal case)
  const rows: ReportRow[] = shown.map((r) => ({ id: r.passportNo, name: r.name, cn: r.cn, passportNo: r.passportNo, entry: parseDdmmyyyy(r.entry), expiry: r.d, tag: `${KIND_LABEL[r.kind]} ${r.jobDate}` }));
  const header = {
    title: "เตือนวีซ่าใกล้หมดอายุ · 签证即将到期提醒",
    subtitle: `${agent && agent !== "(ไม่ระบุ)" ? `${agent} · ` : ""}ข้อมูล ณ ${thDate(today)} · 截至 ${zhDate(today)}${win < 9999 ? ` · ภายใน ${win} วัน · ${win} 天内` : ""}`,
    badge: "VISA EXPIRY REMINDER",
    count: `👥 ${shown.length} คน · ${shown.length} 人`,
    note: "กรุณานัดวีซ่ารันหรือต่อวีซ่าล่วงหน้าอย่างน้อย 3 วันก่อนหมดอายุ · 请至少提前 3 天预约过境或延期",
    urgent: true,
  };
  async function exportPng() {
    const el = ref.current; if (!el || !shown.length) return;
    setStatus("กำลังทำรูป…");
    try {
      await loadScript("https://cdnjs.cloudflare.com/ajax/libs/html-to-image/1.11.11/html-to-image.min.js");
      const hti = (window as unknown as { htmlToImage: { toBlob: (el: HTMLElement, o: Record<string, unknown>) => Promise<Blob | null> } }).htmlToImage;
      const blob = await hti.toBlob(el, { pixelRatio: 2, cacheBust: false, backgroundColor: "#ffffff" });
      if (blob) downloadBlob(blob, `reminder_${fmtDdmmyyyy(today).replace(/\//g, "")}_${agent && agent !== "(ไม่ระบุ)" ? agent : "all"}.png`);
      setStatus("");
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setStatus(""); }
  }
  function lineMessage(list: typeof shown): string {
    const th = list.map((r) => `• ${r.name}${r.cn ? ` ${r.cn}` : ""} (${r.passportNo}) หมด ${r.expiry}${r.left < 0 ? ` ⚠️ เกินแล้ว ${-r.left} วัน` : r.left === 0 ? " ⚠️ วันนี้" : ` (อีก ${r.left} วัน)`}`).join("\n");
    const zh = list.map((r) => `• ${r.cn || r.name} (${r.passportNo}) ${r.expiry} 到期${r.left < 0 ? ` ⚠️ 已逾期 ${-r.left} 天` : r.left === 0 ? " ⚠️ 今天" : `（还剩 ${r.left} 天）`}`).join("\n");
    return `⏰ แจ้งเตือนวีซ่าใกล้หมดอายุ (${fmtDdmmyyyy(today)})\n${th}\n\nกรุณานัดวีซ่ารัน/ต่อวีซ่าล่วงหน้า อยู่เกินปรับวันละ 500 บาท\n\n⏰ 签证即将到期提醒 (${fmtDdmmyyyy(today)})\n${zh}\n\n请提前预约过境/延期，逾期每天罚款 500 泰铢\n— ABC · Alliance Border Consulting`;
  }
  async function copyMessage(list: typeof shown) {
    try { await navigator.clipboard.writeText(lineMessage(list)); setStatus("ก๊อปข้อความแล้ว วางใน LINE ได้เลย"); } catch { setError("ก๊อปไม่ได้ — เบราว์เซอร์ไม่อนุญาต"); }
  }
  async function remove(pp: string) {
    if (!window.confirm(`ลบ ${pp} ออกจากทะเบียน?`)) return;
    await fetch(`/api/expiry?pp=${encodeURIComponent(pp)}`, { method: "DELETE" });
    void load();
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">⏰ ใกล้หมดอายุ</h1>
          <p className="text-sm text-slate-600">ทะเบียนวันหมดอายุจากงานทุกวัน (ต่อวีซ่า + วีซ่ารัน) — ดูว่าใครของโรงงานไหนต้องรัน/ต่อเมื่อไหร่ แล้วส่งรูปหรือข้อความเตือนให้เขาก่อน</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {overdue > 0 && <span className="rounded bg-red-600 px-2 py-0.5 font-semibold text-white">เกินแล้ว {overdue}</span>}
          {week > 0 && <span className="rounded bg-red-100 px-2 py-0.5 font-semibold text-red-900">ภายใน 7 วัน {week}</span>}
          <span className="text-slate-500">ทั้งหมด {records?.length ?? "…"} คน</span>
        </div>
      </header>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-xs text-slate-500">ภายใน:</span>
        {WINDOWS.map((w) => <button key={w} type="button" onClick={() => setWin(w)} className={`rounded-full px-3 py-0.5 text-xs ${win === w ? "bg-red-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>{w === 9999 ? "ทั้งหมด" : `${w} วัน`}</button>)}
        <span className="ml-2 text-xs text-slate-500">โรงงาน/เอเจนซี่:</span>
        <select value={agent} onChange={(e) => setAgent(e.target.value)} className={inputCls + " w-48"}>
          <option value="">ทุกเจ้า</option>
          {agents.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นชื่อ / จีน / พาสปอร์ต" className={inputCls + " w-56"} />
        <button type="button" onClick={exportPng} disabled={!shown.length} className={btnPrimaryCls}>⬇ รูปเตือน (PNG)</button>
        <button type="button" onClick={() => copyMessage(shown)} disabled={!shown.length} className={btnCls}>📋 ก๊อปข้อความ LINE</button>
        <button type="button" onClick={() => void load()} className={btnCls}>↻</button>
        {status && <span className="text-xs text-slate-500">{status}</span>}
      </div>
      {error && <div className="mb-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {records === null && <p className="text-sm text-slate-400">กำลังโหลด…</p>}
      {records && shown.length === 0 && <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">ไม่มีใครหมดอายุในช่วงนี้ 🎉 — ทะเบียนจะเพิ่มเองเมื่อกด "สรุปหมดอายุ" หรือ "บันทึกทะเบียน" ในหน้างาน</p>}

      <div className="space-y-4">
        {groups.map(([a, list]) => (
          <section key={a} className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-slate-900">{a} <span className="font-normal text-slate-500">({list.length} คน)</span></h2>
              <div className="flex gap-2">
                <button type="button" onClick={() => { setAgent(a); }} className={btnCls + " px-2 py-0.5 text-xs"} title="กรองเฉพาะเจ้านี้ แล้วกดรูปเตือน">🎯 เฉพาะเจ้านี้</button>
                <button type="button" onClick={() => copyMessage(list)} className={btnCls + " px-2 py-0.5 text-xs"}>📋 ข้อความ LINE</button>
              </div>
            </div>
            <table className="mt-2 w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="py-1">ชื่อ</th><th>พาสปอร์ต</th><th>งานล่าสุด</th><th>เข้าเมือง</th><th>หมดอายุ</th><th></th><th></th></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.passportNo} className="border-t border-slate-100">
                    <td className="py-1.5"><span className="font-mono font-semibold">{r.name}</span> <span className="text-slate-700">{r.cn}</span>{r.phone && <span className="ml-2 text-xs text-slate-400">{r.phone}</span>}</td>
                    <td className="font-mono">{r.passportNo}</td>
                    <td className="text-xs text-slate-500">{KIND_LABEL[r.kind]} · {OFFICES[r.office as OfficeId]?.short ?? r.office} · {r.jobDate}</td>
                    <td>{r.entry}</td>
                    <td className="font-semibold">{r.expiry}</td>
                    <td>
                      <span className={`rounded px-2 py-0.5 text-xs font-semibold ${r.left < 0 ? "bg-red-700 text-white" : r.left <= 7 ? "bg-red-100 text-red-900" : r.left <= 14 ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>
                        {r.left < 0 ? `เกินแล้ว ${-r.left} วัน` : r.left === 0 ? "วันนี้" : `อีก ${r.left} วัน`}
                      </span>
                    </td>
                    <td className="text-right"><button type="button" onClick={() => remove(r.passportNo)} className="text-xs text-slate-400 hover:text-red-600">ลบ</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>

      <div className="mt-8">
        <h2 className="mb-2 text-sm font-semibold text-slate-700">ตัวอย่างรูปเตือน (ตามตัวกรองด้านบน)</h2>
        <div className="overflow-auto rounded-2xl ring-1 ring-slate-200">
          <ExpiryReport ref={ref} rows={rows} header={header} today={today} />
        </div>
      </div>
    </div>
  );
}

const inputCls = "rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/30";
const btnCls = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimaryCls = "rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50";
