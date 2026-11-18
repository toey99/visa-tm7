"use client";

// =============================================================
// /jobs — 🗂 วีซ่ายาว: Non-O / Non-B / Non-ED / retirement / DTV … per case
// =============================================================
// One line per case with its sale price and all-in cost, so the dashboard
// and the agent ledger count it on the day it is filed. Status and the
// result date keep track of what is still pending.

import { useEffect, useMemo, useState } from "react";
import { JOB_STATUS, JOB_TYPES, type Job } from "@/lib/jobs/store";
import { MAIN_AGENTS } from "@/lib/today/agents";

const bkkToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const money = (n: number) => Math.round(n).toLocaleString("en-US");
const dm = (d: string) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "");
const inp = "w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm";
const blank = (): Job => ({ id: "", day: bkkToday(), type: JOB_TYPES[0], customer: "", cn: "", passportNo: "", nationality: "", agent: "", office: "BANGKOK", sale: 0, cost: 0, costNote: "", status: "ยื่นแล้ว", dueDay: "", note: "", paid: "pending", createdAt: "", updatedAt: "" });

export default function JobsPage() {
  const [month, setMonth] = useState(bkkToday().slice(0, 7));
  const [jobs, setJobs] = useState<Job[]>([]);
  const [edit, setEdit] = useState<Job | null>(null);
  const [prevMonth, setPrevMonth] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function load(m = month) {
    setBusy("กำลังโหลด…"); setError("");
    try { const r = await fetch(`/api/jobs?month=${m}`, { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setJobs(j.jobs); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }
  useEffect(() => { void load(month); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [month]);

  async function save() {
    if (!edit) return;
    setBusy("กำลังบันทึก…"); setError("");
    try {
      const r = await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ job: edit, prevMonth }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      // remember the last price used per type, to prefill next time
      try { localStorage.setItem(`job-price:${edit.type}`, JSON.stringify({ sale: edit.sale, cost: edit.cost, costNote: edit.costNote })); } catch { /* ignore */ }
      setEdit(null); setPrevMonth("");
      if (j.job.day.slice(0, 7) !== month) setMonth(j.job.day.slice(0, 7)); else await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }
  async function remove(j: Job) {
    if (!confirm(`ลบงาน ${j.customer} (${j.type})?`)) return;
    await fetch("/api/jobs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: { month: j.day.slice(0, 7), id: j.id } }) });
    await load();
  }
  function startNew() {
    const b = blank();
    try { const p = JSON.parse(localStorage.getItem(`job-price:${b.type}`) || "null"); if (p) Object.assign(b, p); } catch { /* ignore */ }
    setEdit(b); setPrevMonth("");
  }
  function setType(t: string) {
    if (!edit) return;
    let extra = {};
    try { const p = JSON.parse(localStorage.getItem(`job-price:${t}`) || "null"); if (p && !edit.sale && !edit.cost) extra = p; } catch { /* ignore */ }
    setEdit({ ...edit, type: t, ...extra });
  }

  const tot = useMemo(() => jobs.reduce((a, j) => (j.status === "ยกเลิก" ? a : { sale: a.sale + j.sale, cost: a.cost + j.cost, n: a.n + 1 }), { sale: 0, cost: 0, n: 0 }), [jobs]);
  const pending = jobs.filter((j) => j.status === "ยื่นแล้ว" || j.status === "รอพิจารณา");
  const sorted = [...jobs].sort((a, b) => b.day.localeCompare(a.day));

  return (
    <main className="mx-auto max-w-4xl p-3 sm:p-5">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-indigo-700">🗂 วีซ่ายาว</h1>
        <div className="ml-auto flex items-center gap-1">
          <input type="month" className={inp} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <button className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white" onClick={startNew}>＋ งานใหม่</button>
        </div>
      </header>
      <p className="mb-3 text-xs text-slate-500">งานที่ไม่จบในวัน (Non-O / Non-B / Non-ED / เกษียณ / DTV …) ใส่ยอดขายและต้นทุนรวมต่อเคส — เข้า Dashboard และบัญชีเอเย่นต์ตามวันที่ยื่น</p>
      {error && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {busy && <div className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">{busy}</div>}

      <section className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="งานเดือนนี้" value={String(tot.n)} tone="indigo" />
        <Tile label="ยอดขาย" value={money(tot.sale)} tone="blue" />
        <Tile label="ต้นทุน" value={money(tot.cost)} tone="amber" />
        <Tile label="กำไร" value={money(tot.sale - tot.cost)} tone="green" />
      </section>
      {pending.length > 0 && <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">⏳ รอผล {pending.length} เคส: {pending.map((j) => `${j.customer}${j.dueDay ? ` (${dm(j.dueDay)})` : ""}`).join(" · ")}</div>}

      {edit && (
        <section className="mb-3 rounded-xl border border-indigo-200 bg-indigo-50/40 p-3">
          <h2 className="mb-2 text-sm font-semibold text-indigo-800">{edit.id ? "แก้ไขงาน" : "งานใหม่"}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <L label="วันที่ยื่น/ทำ"><input type="date" className={inp} value={edit.day} onChange={(e) => setEdit({ ...edit, day: e.target.value })} /></L>
            <L label="ประเภท"><select className={inp} value={edit.type} onChange={(e) => setType(e.target.value)}>{JOB_TYPES.map((t) => <option key={t}>{t}</option>)}</select></L>
            <L label="สำนักงาน"><input className={inp} value={edit.office ?? ""} onChange={(e) => setEdit({ ...edit, office: e.target.value.toUpperCase() })} placeholder="BANGKOK" /></L>
            <L label="ชื่อลูกค้า (ตามพาส)"><input className={inp} value={edit.customer} onChange={(e) => setEdit({ ...edit, customer: e.target.value.toUpperCase() })} /></L>
            <L label="ชื่อจีน"><input className={inp} value={edit.cn ?? ""} onChange={(e) => setEdit({ ...edit, cn: e.target.value })} /></L>
            <L label="เลขพาส"><input className={inp} value={edit.passportNo ?? ""} onChange={(e) => setEdit({ ...edit, passportNo: e.target.value.toUpperCase() })} /></L>
            <L label="สัญชาติ"><input className={inp} value={edit.nationality ?? ""} onChange={(e) => setEdit({ ...edit, nationality: e.target.value.toUpperCase() })} placeholder="CHINESE" /></L>
            <L label="เอเย่นต์"><input className={inp} list="agents" value={edit.agent} onChange={(e) => setEdit({ ...edit, agent: e.target.value })} placeholder="ลูกค้าตรง" /><datalist id="agents">{MAIN_AGENTS.map((a) => <option key={a} value={a} />)}<option value="ลูกค้าตรง" /></datalist></L>
            <L label="สถานะ"><select className={inp} value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as Job["status"] })}>{JOB_STATUS.map((s) => <option key={s}>{s}</option>)}</select></L>
            <L label="ยอดขาย (บาท)"><input className={inp} inputMode="numeric" value={edit.sale || ""} onChange={(e) => setEdit({ ...edit, sale: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} /></L>
            <L label="ต้นทุนรวม (บาท)"><input className={inp} inputMode="numeric" value={edit.cost || ""} onChange={(e) => setEdit({ ...edit, cost: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} /></L>
            <L label="ต้นทุนมีอะไรบ้าง"><input className={inp} value={edit.costNote ?? ""} onChange={(e) => setEdit({ ...edit, costNote: e.target.value })} placeholder="ค่าธรรมเนียม 2,000 + …" /></L>
            <L label="วันนัดรับผล"><input type="date" className={inp} value={edit.dueDay ?? ""} onChange={(e) => setEdit({ ...edit, dueDay: e.target.value })} /></L>
            <L label="การเงิน"><select className={inp} value={edit.paid ?? "pending"} onChange={(e) => setEdit({ ...edit, paid: e.target.value as Job["paid"] })}><option value="pending">ยังไม่จ่าย</option><option value="paid">จ่ายแล้ว</option><option value="agent">เก็บที่เอเย่นต์</option></select></L>
            <L label="หมายเหตุ"><input className={inp} value={edit.note ?? ""} onChange={(e) => setEdit({ ...edit, note: e.target.value })} /></L>
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm">
            <span className="text-slate-600">กำไร: <b className={edit.sale - edit.cost < 0 ? "text-rose-600" : "text-emerald-700"}>{money(edit.sale - edit.cost)}</b></span>
            <button className="ml-auto rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white" onClick={() => void save()}>บันทึก</button>
            <button className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm" onClick={() => { setEdit(null); setPrevMonth(""); }}>ยกเลิก</button>
          </div>
        </section>
      )}

      <section className="rounded-xl border border-slate-200 bg-white p-3">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-400"><th>วัน</th><th>ลูกค้า</th><th>ประเภท</th><th>เอเย่นต์</th><th>สถานะ</th><th className="text-right">ขาย</th><th className="text-right">ต้นทุน</th><th className="text-right">กำไร</th><th></th></tr></thead>
          <tbody>
            {sorted.map((j) => (
              <tr key={j.id} className={`border-t border-slate-100 ${j.status === "ยกเลิก" ? "opacity-50" : ""}`}>
                <td className="py-1 whitespace-nowrap">{dm(j.day)}</td>
                <td><div className="font-medium">{j.customer}{j.cn ? <span className="ml-1 text-slate-500">{j.cn}</span> : null}</div><div className="text-[11px] text-slate-400">{j.passportNo}{j.note ? ` · ${j.note}` : ""}</div></td>
                <td className="text-xs">{j.type}</td>
                <td className="text-xs">{j.agent}</td>
                <td className="text-xs">{j.status}{j.dueDay ? <span className="text-slate-400"> · นัด {dm(j.dueDay)}</span> : null}</td>
                <td className="text-right tabular-nums">{money(j.sale)}</td>
                <td className="text-right tabular-nums text-slate-500" title={j.costNote}>{money(j.cost)}</td>
                <td className={`text-right font-semibold tabular-nums ${j.sale - j.cost < 0 ? "text-rose-600" : "text-emerald-700"}`}>{money(j.sale - j.cost)}</td>
                <td className="whitespace-nowrap text-right"><button className="text-xs text-indigo-600" onClick={() => { setEdit(j); setPrevMonth(j.day.slice(0, 7)); }}>แก้</button> <button className="ml-1 text-xs text-rose-500" onClick={() => void remove(j)}>ลบ</button></td>
              </tr>
            ))}
            {sorted.length === 0 && <tr><td colSpan={9} className="py-3 text-center text-slate-400">ยังไม่มีงานในเดือนนี้ — กด ＋ งานใหม่</td></tr>}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block text-xs text-slate-600">{label}{children}</label>; }
function Tile({ label, value, tone }: { label: string; value: string; tone: "indigo" | "blue" | "amber" | "green" }) {
  const c = { indigo: "bg-indigo-50 text-indigo-700", blue: "bg-blue-50 text-blue-700", amber: "bg-amber-50 text-amber-700", green: "bg-emerald-50 text-emerald-700" }[tone];
  return <div className={`rounded-xl px-3 py-2 ${c}`}><div className="text-[11px] opacity-70">{label}</div><div className="text-xl font-bold tabular-nums">{value}</div></div>;
}
