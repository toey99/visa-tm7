"use client";

// =============================================================
// /dashboard — people, sales, cost and profit over time
// =============================================================
// Reads /api/stats (daily snapshots priced with pricing/config.json; today is
// live from the boards). Charts are plain SVG: stacked people-per-day by
// office in the office colours, profit per day, and an agent table for the
// period. ⚙️ edits the price / cost table.

import { useEffect, useMemo, useState } from "react";
import { OFFICES, type OfficeId } from "@/lib/offices";
import type { DaySummary } from "@/lib/stats/daily";
import type { Pricing } from "@/lib/stats/pricing";

type Resp = { pricing: Pricing; days: DaySummary[]; from: string; to: string; error?: string };
const OFFICE_ORDER: { key: string; label: string; color: string }[] = [
  { key: "BANGKOK", label: "IT", color: OFFICES.BANGKOK.summaryAccent },
  { key: "NONTHABURI", label: "นนท์", color: OFFICES.NONTHABURI.summaryAccent },
  { key: "RAYONG", label: "ระยอง", color: OFFICES.RAYONG.summaryAccent },
  { key: "RUN", label: "วีซ่ารัน", color: OFFICES.CHIANG_SAEN.summaryAccent },
  { key: "VFS_BANGKOK", label: "VFS กทม.", color: OFFICES.VFS_BANGKOK.summaryAccent },
  { key: "VFS_PATTAYA", label: "VFS พัทยา", color: OFFICES.VFS_PATTAYA.summaryAccent },
];
const money = (n: number) => Math.round(n).toLocaleString("en-US");
const bkkToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10);
const dm = (d: string) => `${Number(d.slice(8, 10))}/${Number(d.slice(5, 7))}`;

type Range = { label: string; from: string; to: string };
function ranges(): Range[] {
  const t = bkkToday();
  const y = +t.slice(0, 4), m = +t.slice(5, 7);
  const first = `${t.slice(0, 7)}-01`;
  const prevFirst = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
  const prevLast = addDays(first, -1);
  return [
    { label: "วันนี้", from: t, to: t },
    { label: "7 วัน", from: addDays(t, -6), to: t },
    { label: "30 วัน", from: addDays(t, -29), to: t },
    { label: "เดือนนี้", from: first, to: t },
    { label: "เดือนก่อน", from: prevFirst, to: prevLast },
  ];
}

export default function DashboardPage() {
  const R = useMemo(ranges, []);
  const [range, setRange] = useState<Range>(R[2]);
  const [data, setData] = useState<Resp | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [showCfg, setShowCfg] = useState(false);
  const [hover, setHover] = useState<string | null>(null);

  async function load(r = range) {
    setBusy("กำลังโหลด…"); setError("");
    try {
      const res = await fetch(`/api/stats?from=${r.from}&to=${r.to}`, { cache: "no-store" });
      const j = (await res.json()) as Resp;
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      setData(j);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }
  useEffect(() => { void load(range); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [range]);

  const days = data?.days ?? [];
  const tot = useMemo(() => {
    const t = { people: 0, arrived: 0, sale: 0, cost: 0, profit: 0, collected: 0, toCollect: 0, waiting: 0, hold: 0, vip: 0, overstay: 0, d90: 0, run: 0 };
    for (const d of days) for (const k of Object.keys(t) as (keyof typeof t)[]) t[k] += d[k] ?? 0;
    return t;
  }, [days]);
  const agents = useMemo(() => {
    const m = new Map<string, { people: number; sale: number; cost: number }>();
    for (const d of days) for (const [a, v] of Object.entries(d.byAgent)) { const x = m.get(a) ?? { people: 0, sale: 0, cost: 0 }; x.people += v.people; x.sale += v.sale; x.cost += v.cost; m.set(a, x); }
    return [...m.entries()].sort((a, b) => b[1].sale - a[1].sale);
  }, [days]);
  const hovered = hover ? days.find((d) => d.day === hover) : null;

  return (
    <main className="mx-auto max-w-4xl p-3 sm:p-5">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-pink-600">📊 Dashboard</h1>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {R.map((r) => <button key={r.label} className={`rounded-lg px-2.5 py-1 text-sm ${range.label === r.label ? "bg-pink-500 font-semibold text-white" : "border border-slate-200 bg-white hover:bg-slate-50"}`} onClick={() => setRange(r)}>{r.label}</button>)}
          <button className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-sm" onClick={() => setShowCfg((v) => !v)}>⚙️</button>
        </div>
      </header>
      <p className="mb-3 text-xs text-slate-500">{dm(range.from)} – {dm(range.to)} · รายได้ = ยอดขายเอเย่นต์ตามตารางราคา · วันนี้อ่านสดจากบอร์ด วันอื่นจากสถิติที่เก็บไว้ตอน 23:30</p>
      {error && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {busy && <div className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">{busy}</div>}
      {showCfg && data && <PricingPanel pricing={data.pricing} onSaved={() => void load()} />}

      {/* headline tiles */}
      <section className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label="ลูกค้า" value={`${tot.people}`} sub={`มาแล้ว ${tot.arrived} · รัน ${tot.run} · 90 วัน ${tot.d90} ใบ`} tone="pink" />
        <Tile label="ยอดขาย" value={money(tot.sale)} sub={`ต้นทุน ${money(tot.cost)}`} tone="blue" />
        <Tile label="กำไรขั้นต้น" value={money(tot.profit)} sub={tot.sale ? `${Math.round((tot.profit / tot.sale) * 100)}% ของยอดขาย` : ""} tone={tot.profit >= 0 ? "green" : "rose"} big />
        <Tile label="เงินหน้างาน" value={money(tot.collected)} sub={`ต้องเก็บ ${money(tot.toCollect)} · รอโอน ${money(tot.waiting)}${tot.hold ? ` · hold ${tot.hold}` : ""}`} tone="amber" />
      </section>

      {days.length > 1 && (
        <>
          <Card title="ลูกค้าต่อวัน แยกหน้างาน">
            <StackedBars days={days} hover={hover} setHover={setHover} />
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-600">
              {OFFICE_ORDER.map((o) => <span key={o.key} className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: o.color }} />{o.label}</span>)}
            </div>
            {hovered && <div className="mt-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-700">{dm(hovered.day)}: {hovered.people} คน · {OFFICE_ORDER.filter((o) => hovered.byOffice[o.key]).map((o) => `${o.label} ${hovered.byOffice[o.key]}`).join(" · ")} · ขาย {money(hovered.sale)} · กำไร {money(hovered.profit)}</div>}
          </Card>
          <Card title="กำไรขั้นต้นต่อวัน (บาท)">
            <ProfitBars days={days} hover={hover} setHover={setHover} />
          </Card>
        </>
      )}

      <Card title="ตามเอเย่นต์">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-slate-400"><th>เอเย่นต์</th><th className="text-right">คน</th><th className="text-right">ยอดขาย</th><th className="text-right">ต้นทุน</th><th className="text-right">กำไร</th></tr></thead>
          <tbody>
            {agents.map(([a, v]) => (
              <tr key={a} className="border-t border-slate-100">
                <td className="py-1">{a}</td>
                <td className="text-right tabular-nums">{v.people}</td>
                <td className="text-right tabular-nums">{money(v.sale)}</td>
                <td className="text-right tabular-nums text-slate-500">{money(v.cost)}</td>
                <td className={`text-right font-semibold tabular-nums ${v.sale - v.cost < 0 ? "text-rose-600" : "text-emerald-700"}`}>{money(v.sale - v.cost)}</td>
              </tr>
            ))}
            {agents.length === 0 && <tr><td colSpan={5} className="py-2 text-center text-slate-400">ยังไม่มีข้อมูลในช่วงนี้</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card title="รายวัน">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-400"><th>วัน</th><th className="text-right">คน</th><th className="text-right">มา</th><th className="text-right">ขาย</th><th className="text-right">ต้นทุน</th><th className="text-right">กำไร</th><th className="text-right">เก็บหน้างาน</th></tr></thead>
            <tbody>
              {[...days].reverse().map((d) => (
                <tr key={d.day} className="border-t border-slate-100">
                  <td className="py-1">{dm(d.day)}</td>
                  <td className="text-right tabular-nums">{d.people}</td>
                  <td className="text-right tabular-nums">{d.arrived}</td>
                  <td className="text-right tabular-nums">{money(d.sale)}</td>
                  <td className="text-right tabular-nums text-slate-500">{money(d.cost)}</td>
                  <td className={`text-right tabular-nums ${d.profit < 0 ? "text-rose-600" : ""}`}>{money(d.profit)}</td>
                  <td className="text-right tabular-nums">{money(d.collected)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}

function Tile({ label, value, sub, tone, big }: { label: string; value: string; sub?: string; tone: "pink" | "blue" | "green" | "rose" | "amber"; big?: boolean }) {
  const c = { pink: "bg-pink-50 text-pink-700", blue: "bg-blue-50 text-blue-700", green: "bg-emerald-50 text-emerald-700", rose: "bg-rose-50 text-rose-700", amber: "bg-amber-50 text-amber-700" }[tone];
  return (
    <div className={`rounded-xl px-3 py-2 ${c}`}>
      <div className="text-[11px] opacity-70">{label}</div>
      <div className={`font-bold tabular-nums ${big ? "text-2xl" : "text-xl"}`}>{value}</div>
      {sub && <div className="text-[11px] opacity-70">{sub}</div>}
    </div>
  );
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mb-3 rounded-xl border border-slate-200 bg-white p-3"><h2 className="mb-2 text-sm font-semibold text-slate-700">{title}</h2>{children}</section>;
}

// stacked people-per-day, office colours, 2px gaps between segments, rounded top
function StackedBars({ days, hover, setHover }: { days: DaySummary[]; hover: string | null; setHover: (d: string | null) => void }) {
  const W = 720, H = 180, padL = 28, padB = 18;
  const max = Math.max(1, ...days.map((d) => d.people));
  const bw = (W - padL) / days.length;
  const ticks = [0, Math.ceil(max / 2), max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="ลูกค้าต่อวัน">
      {ticks.map((t) => { const y = H - padB - (t / max) * (H - padB - 10); return <g key={t}><line x1={padL} x2={W} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} /><text x={padL - 4} y={y + 3} fontSize={9} textAnchor="end" fill="#94a3b8">{t}</text></g>; })}
      {days.map((d, i) => {
        let y = H - padB;
        const x = padL + i * bw + 2;
        const w = Math.max(2, bw - 4);
        return (
          <g key={d.day} onMouseEnter={() => setHover(d.day)} onMouseLeave={() => setHover(null)} onClick={() => setHover(d.day)} opacity={hover && hover !== d.day ? 0.5 : 1}>
            <rect x={x - 2} y={10} width={w + 4} height={H - padB - 10} fill="transparent" />
            {OFFICE_ORDER.map((o) => {
              const n = d.byOffice[o.key] ?? 0; if (!n) return null;
              const h = (n / max) * (H - padB - 10);
              y -= h;
              return <rect key={o.key} x={x} y={y + 1} width={w} height={Math.max(0, h - 2)} rx={2} fill={o.color} />;
            })}
            {d.people > 0 && <text x={x + w / 2} y={y - 3} fontSize={9} textAnchor="middle" fill="#475569">{d.people}</text>}
            {(days.length <= 10 || i % Math.ceil(days.length / 10) === 0) && <text x={x + w / 2} y={H - 5} fontSize={9} textAnchor="middle" fill="#94a3b8">{dm(d.day)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function ProfitBars({ days, hover, setHover }: { days: DaySummary[]; hover: string | null; setHover: (d: string | null) => void }) {
  const W = 720, H = 150, padL = 44, padB = 18;
  const max = Math.max(1, ...days.map((d) => Math.abs(d.profit)));
  const neg = days.some((d) => d.profit < 0);
  const zeroY = neg ? (H - padB) / 2 : H - padB;
  const scale = (neg ? (H - padB) / 2 - 10 : H - padB - 10) / max;
  const bw = (W - padL) / days.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="กำไรต่อวัน">
      <line x1={padL} x2={W} y1={zeroY} y2={zeroY} stroke="#cbd5e1" strokeWidth={1} />
      <text x={padL - 4} y={14} fontSize={9} textAnchor="end" fill="#94a3b8">{money(max)}</text>
      <text x={padL - 4} y={zeroY + 3} fontSize={9} textAnchor="end" fill="#94a3b8">0</text>
      {days.map((d, i) => {
        const h = Math.abs(d.profit) * scale;
        const x = padL + i * bw + 2, w = Math.max(2, bw - 4);
        const y = d.profit >= 0 ? zeroY - h : zeroY;
        return (
          <g key={d.day} onMouseEnter={() => setHover(d.day)} onMouseLeave={() => setHover(null)} opacity={hover && hover !== d.day ? 0.5 : 1}>
            <rect x={x} y={y} width={w} height={h} rx={2} fill={d.profit >= 0 ? "#10b981" : "#f43f5e"} />
            {hover === d.day && <text x={x + w / 2} y={d.profit >= 0 ? y - 3 : y + h + 10} fontSize={9} textAnchor="middle" fill="#475569">{money(d.profit)}</text>}
          </g>
        );
      })}
    </svg>
  );
}

function PricingPanel({ pricing, onSaved }: { pricing: Pricing; onSaved: () => void }) {
  const [p, setP] = useState<Pricing>(pricing);
  const [busy, setBusy] = useState(false);
  useEffect(() => setP(pricing), [pricing]);
  const offices = Object.keys(p.sale.ext) as OfficeId[];
  const setExt = (o: OfficeId, v: number) => setP({ ...p, sale: { ...p.sale, ext: { ...p.sale.ext, [o]: { ...p.sale.ext[o], default: v } } } });
  const setExtAgent = (o: OfficeId, agent: string, v: number | null) => { const by = { ...p.sale.ext[o].byAgent }; if (v === null) delete by[agent]; else by[agent] = v; setP({ ...p, sale: { ...p.sale, ext: { ...p.sale.ext, [o]: { ...p.sale.ext[o], byAgent: by } } } }); };
  const setCostExt = (o: OfficeId, v: number) => setP({ ...p, cost: { ...p.cost, ext: { ...p.cost.ext, [o]: v } } });
  const n = (s: string) => Number(s.replace(/[^\d.]/g, "")) || 0;
  async function save() {
    setBusy(true);
    try { const r = await fetch("/api/stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pricing: p }) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); onSaved(); }
    catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  const [newAgent, setNewAgent] = useState<Record<string, string>>({});
  return (
    <section className="mb-3 rounded-xl border border-pink-200 bg-pink-50/40 p-3 text-sm">
      <h2 className="mb-2 font-semibold text-pink-800">⚙️ ราคาขายและต้นทุน (บาท/คน)</h2>
      <table className="w-full text-xs">
        <thead><tr className="text-left text-slate-500"><th>ต่อ 30 วัน</th><th>ขายมาตรฐาน</th><th>ขายตามเอเย่นต์</th><th>ต้นทุน</th></tr></thead>
        <tbody>
          {offices.map((o) => (
            <tr key={o} className="border-t border-pink-100 align-top">
              <td className="py-1 font-medium">{OFFICES[o].label}</td>
              <td><input className="inp w-20" inputMode="numeric" value={p.sale.ext[o].default} onChange={(e) => setExt(o, n(e.target.value))} /></td>
              <td>
                {Object.entries(p.sale.ext[o].byAgent).map(([a, v]) => (
                  <div key={a} className="mb-1 flex items-center gap-1"><span className="w-16 truncate">{a}</span><input className="inp w-20" inputMode="numeric" value={v} onChange={(e) => setExtAgent(o, a, n(e.target.value))} /><button className="text-rose-500" onClick={() => setExtAgent(o, a, null)}>✕</button></div>
                ))}
                <div className="flex items-center gap-1"><input className="inp w-16" placeholder="เอเย่นต์" value={newAgent[o] ?? ""} onChange={(e) => setNewAgent({ ...newAgent, [o]: e.target.value })} /><button className="rounded bg-white px-1.5 ring-1 ring-pink-200" onClick={() => { const a = (newAgent[o] ?? "").trim(); if (a) { setExtAgent(o, a, p.sale.ext[o].default); setNewAgent({ ...newAgent, [o]: "" }); } }}>+</button></div>
              </td>
              <td><input className="inp w-20" inputMode="numeric" value={p.cost.ext[o]} onChange={(e) => setCostExt(o, n(e.target.value))} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {([
          ["วีซ่ารัน ขาย (2 คนขึ้นไป)", p.sale.runShared, (v: number) => setP({ ...p, sale: { ...p.sale, runShared: v } })],
          ["วีซ่ารัน ขาย (รถ 1 คน)", p.sale.runSolo, (v: number) => setP({ ...p, sale: { ...p.sale, runSolo: v } })],
          ["วีซ่ารัน ต้นทุนเพิ่ม อินเดีย/คน", p.cost.runIndian, (v: number) => setP({ ...p, cost: { ...p.cost, runIndian: v } })],
          ["วีซ่ารัน ขาย อินเดีย พี่หนู/คน", p.sale.runIndianByAgent["พี่หนู"] ?? 0, (v: number) => setP({ ...p, sale: { ...p.sale, runIndianByAgent: { ...p.sale.runIndianByAgent, "พี่หนู": v } } })],
          ["วีซ่ารัน ขาย อินเดีย เอเย่นต์อื่น/คน (0 = ปกติ)", p.sale.runIndian, (v: number) => setP({ ...p, sale: { ...p.sale, runIndian: v } })],
          ["🐰 +30 ขาย", p.sale.run30, (v: number) => setP({ ...p, sale: { ...p.sale, run30: v } })],
          ["🐰 +30 ต้นทุน", p.cost.run30, (v: number) => setP({ ...p, cost: { ...p.cost, run30: v } })],
          ["🐻 กัมพูชา ขาย", p.sale.cambodia, (v: number) => setP({ ...p, sale: { ...p.sale, cambodia: v } })],
          ["🐻 กัมพูชา ต้นทุน", p.cost.cambodia, (v: number) => setP({ ...p, cost: { ...p.cost, cambodia: v } })],
          ["overstay ค่าดำเนินการ (ขาย)", p.sale.overstayBase, (v: number) => setP({ ...p, sale: { ...p.sale, overstayBase: v } })],
          ["overstay ค่าปรับ/วัน (ขาย)", p.sale.overstayPerDay, (v: number) => setP({ ...p, sale: { ...p.sale, overstayPerDay: v } })],
          ["overstay ค่าปรับ/วัน (ต้นทุน)", p.cost.overstayPerDay, (v: number) => setP({ ...p, cost: { ...p.cost, overstayPerDay: v } })],
          ["VIP ขาย", p.sale.vip, (v: number) => setP({ ...p, sale: { ...p.sale, vip: v } })],
          ["VIP ต้นทุน", p.cost.vip, (v: number) => setP({ ...p, cost: { ...p.cost, vip: v } })],
          ["90 วัน ขาย/ใบ", p.sale.d90, (v: number) => setP({ ...p, sale: { ...p.sale, d90: v } })],
          ["90 วัน ต้นทุน/ใบ", p.cost.d90, (v: number) => setP({ ...p, cost: { ...p.cost, d90: v } })],
        ] as [string, number, (v: number) => void][]).map(([label, v, set]) => (
          <label key={label} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1 text-xs"><span>{label}</span><input className="inp w-20 text-right" inputMode="numeric" value={v} onChange={(e) => set(n(e.target.value))} /></label>
        ))}
      </div>
      <div className="mt-2 text-xs text-slate-600">ต้นทุนวีซ่ารันต่อหัว ตามจำนวนคนในรถ:
        {([1, 2, 3, 4] as const).map((k) => <label key={k} className="ml-2 inline-flex items-center gap-1">{k} คน <input className="inp w-16" inputMode="numeric" value={p.cost.runPerHead[k]} onChange={(e) => setP({ ...p, cost: { ...p.cost, runPerHead: { ...p.cost.runPerHead, [k]: n(e.target.value) } } })} /></label>)}
      </div>
      <button disabled={busy} className="mt-3 rounded-lg bg-pink-500 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void save()}>{busy ? "กำลังบันทึก…" : "บันทึกราคา"}</button>
      <style>{`.inp { border: 1px solid #e2e8f0; border-radius: .4rem; padding: .2rem .4rem; font-size: .75rem; background: #fff; }`}</style>
    </section>
  );
}
