"use client";
// =============================================================
// Visa run — cheapest way to fill the cars
// =============================================================
// The checkpoint charges per head by how many ride in the car (1–4), so how
// the day's riders are split over cars changes the bill. This card takes the
// riders on the board, groups them by flight (people landing at different
// times cannot share a car), works out the split with the lowest total, and
// compares it with the cars as they are assigned now. A small "what if" box
// does the same for any head count. Extras (+30, Cambodia, fines, wet
// passport, Indian visa) do not depend on the split and are left out.
import { useEffect, useMemo, useState } from "react";
import type { Pricing } from "@/lib/stats/pricing";
import type { DayMeta, Person } from "@/lib/today/types";
import { carKey } from "@/lib/visarun/cars";

type PerHead = Record<1 | 2 | 3 | 4, number>;
const FALLBACK: PerHead = { 1: 9800, 2: 9000, 3: 8350, 4: 8150 };
const money = (n: number) => Math.round(n).toLocaleString("en-US");
const carCost = (ph: PerHead, size: number) => { const s = Math.min(4, Math.max(1, size)) as 1 | 2 | 3 | 4; return ph[s] * size; };

/** Every way to split n riders into cars of 1–4 (largest first), cheapest first. n ≤ 24 here; above that only the best. */
export function splits(n: number, ph: PerHead): { combo: number[]; cost: number }[] {
  if (n <= 0) return [];
  if (n > 24) {
    const best = new Array<number>(n + 1).fill(Infinity), via = new Array<number>(n + 1).fill(0);
    best[0] = 0;
    for (let i = 1; i <= n; i++) for (let c = 1; c <= 4 && c <= i; c++) if (best[i - c] + ph[c as 1] * c < best[i]) { best[i] = best[i - c] + ph[c as 1] * c; via[i] = c; }
    const combo: number[] = [];
    for (let i = n; i > 0; i -= via[i]) combo.push(via[i]);
    return [{ combo: combo.sort((a, b) => b - a), cost: best[n] }];
  }
  const out: { combo: number[]; cost: number }[] = [];
  const walk = (left: number, max: number, cur: number[]) => {
    if (!left) { out.push({ combo: [...cur], cost: cur.reduce((s, c) => s + ph[c as 1] * c, 0) }); return; }
    for (let c = Math.min(left, max); c >= 1; c--) { cur.push(c); walk(left - c, c, cur); cur.pop(); }
  };
  walk(n, 4, []);
  return out.sort((a, b) => a.cost - b.cost || a.combo.length - b.combo.length);
}
const comboText = (c: number[]) => c.join(" + ");

export default function RunPlanner({ people, meta }: { people: Person[]; meta: DayMeta }) {
  const [ph, setPh] = useState<PerHead>(FALLBACK);
  const [fromTable, setFromTable] = useState(false);
  const [open, setOpen] = useState(true);
  const [whatIf, setWhatIf] = useState("");
  useEffect(() => {
    let alive = true;
    fetch("/api/stats?from=2000-01-01&to=2000-01-01", { cache: "no-store" }).then((r) => r.json()).then((j: { pricing?: Pricing }) => {
      const t = j.pricing?.cost?.runPerHead;
      if (alive && t) { setPh({ 1: Number(t[1]) || FALLBACK[1], 2: Number(t[2]) || FALLBACK[2], 3: Number(t[3]) || FALLBACK[3], 4: Number(t[4]) || FALLBACK[4] }); setFromTable(true); }
    }).catch(() => { /* keep the fallback table */ });
    return () => { alive = false; };
  }, []);

  const plan = useMemo(() => {
    // riders who can share: same landing time + flight (a person's own flight overrides the day's)
    const groups = new Map<string, { label: string; n: number }>();
    for (const p of people) {
      const land = (p.fields.landTime || meta.landTime || "").trim(), flight = (p.fields.flight || meta.flight || "").trim();
      const key = `${land}|${flight}`;
      const g = groups.get(key) ?? { label: [land ? `ลง ${land}` : "", flight].filter(Boolean).join(" · ") || "ไม่ระบุเที่ยวบิน", n: 0 };
      g.n++; groups.set(key, g);
    }
    const byFlight = [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, g]) => ({ key, ...g, best: splits(g.n, ph)[0] }));
    const bestTotal = byFlight.reduce((s, g) => s + (g.best?.cost ?? 0), 0);
    // the cars as assigned now (a car + round = one ride)
    const rides = new Map<string, number>();
    let unassigned = 0;
    for (const p of people) { const k = carKey(p.fields); if (k) rides.set(k, (rides.get(k) ?? 0) + 1); else unassigned++; }
    const sizes = [...rides.values()].sort((a, b) => b - a);
    const nowTotal = sizes.reduce((s, n) => s + carCost(ph, n), 0);
    return { byFlight, bestTotal, sizes, nowTotal, unassigned };
  }, [people, meta.landTime, meta.flight, ph]);

  const n = Math.min(200, Math.max(0, Math.floor(Number(whatIf) || 0)));
  const options = useMemo(() => (n ? splits(n, ph).slice(0, 4) : []), [n, ph]);
  const allSeated = people.length > 0 && plan.unassigned === 0;
  const extra = allSeated ? plan.nowTotal - plan.bestTotal : 0;

  return (
    <section className="mb-6 rounded-2xl border border-teal-200 bg-teal-50/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-teal-800">🧮 จัดรถให้ต้นทุนด่านต่ำสุด</h2>
        <span className="text-[11px] text-slate-500">ต้นทุน/คน: 1 คน {money(ph[1])} · 2 คน {money(ph[2])} · 3 คน {money(ph[3])} · 4 คน {money(ph[4])}{fromTable ? " (จากตารางต้นทุนใน Dashboard ⚙️)" : ""}</span>
        <button type="button" onClick={() => setOpen((v) => !v)} className="ml-auto rounded-lg bg-white px-2.5 py-1 text-xs text-slate-600 ring-1 ring-slate-200">{open ? "ย่อ" : "เปิด"}</button>
      </div>
      {open && (
        <>
          {people.length === 0 ? <p className="mt-2 text-sm text-slate-400">ยังไม่มีคนในบอร์ดวันนี้ — ลองใส่จำนวนคนด้านล่างได้</p> : (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {plan.byFlight.map((g) => (
                <div key={g.key} className="rounded-xl bg-white p-3 ring-1 ring-teal-100">
                  <div className="text-xs font-semibold text-slate-500">✈ {g.label} · {g.n} คน</div>
                  <div className="mt-0.5 text-lg font-extrabold text-teal-700">{g.best ? comboText(g.best.combo) : "–"} <span className="text-xs font-semibold text-slate-500">({g.best?.combo.length ?? 0} คัน)</span></div>
                  <div className="text-sm font-semibold tabular-nums text-slate-700">{money(g.best?.cost ?? 0)} บาท <span className="text-xs font-normal text-slate-400">เฉลี่ย {money((g.best?.cost ?? 0) / g.n)}/คน</span></div>
                </div>
              ))}
            </div>
          )}
          {people.length > 0 && (
            <div className={`mt-2 rounded-xl p-3 text-sm ${!allSeated ? "bg-amber-50 text-amber-800" : extra > 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"}`}>
              <div className="font-semibold">ต่ำสุดทั้งวัน {money(plan.bestTotal)} บาท ({people.length} คน)</div>
              {plan.sizes.length > 0 && <div>ที่จัดไว้ตอนนี้: {comboText(plan.sizes)} = {money(plan.nowTotal)} บาท{plan.unassigned ? ` · ยังไม่ได้จัดรถ ${plan.unassigned} คน` : ""}</div>}
              {!plan.sizes.length && <div>ยังไม่ได้จัดรถ {plan.unassigned} คน</div>}
              {allSeated && (extra > 0 ? <div className="font-bold">⚠ แพงกว่าต่ำสุด {money(extra)} บาท — ลองจัดตามจำนวนด้านบน</div> : <div className="font-bold">✅ จัดได้ต้นทุนต่ำสุดแล้ว</div>)}
              {plan.sizes.some((s) => s > 4) && <div>⚠ มีรถที่จัดเกิน 4 คน (คิดต้นทุนต่อคนแบบรถ 4 คน)</div>}
            </div>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-600">ลองคำนวณ</span>
            <input value={whatIf} onChange={(e) => setWhatIf(e.target.value.replace(/\D/g, "").slice(0, 3))} inputMode="numeric" placeholder={String(people.length || 5)} className="w-16 rounded-lg border border-slate-300 px-2 py-1 text-center font-semibold" />
            <span className="text-slate-600">คน (เที่ยวบินเดียวกัน)</span>
          </div>
          {options.length > 0 && (
            <div className="mt-2 space-y-1">
              {options.map((o, i) => (
                <div key={i} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm ${i === 0 ? "bg-teal-600 font-semibold text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"}`}>
                  <span>{i === 0 ? "⭐ " : `#${i + 1} `}{comboText(o.combo)} <span className={i === 0 ? "text-teal-100" : "text-slate-400"}>({o.combo.length} คัน)</span></span>
                  <span className="tabular-nums">{money(o.cost)} บาท{i > 0 ? <span className="ml-2 text-xs text-rose-600">+{money(o.cost - options[0].cost)}</span> : <span className="ml-2 text-xs text-teal-100">เฉลี่ย {money(o.cost / n)}/คน</span>}</span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11px] text-slate-400">คิดเฉพาะค่ารถ/ด่านต่อหัวตามจำนวนคนในรถ · ค่าต่อ 30 วัน กัมพูชา ค่าปรับ เล่มเปียกน้ำ และวีซ่าลาวไม่ขึ้นกับการจัดรถ จึงไม่รวม · คนที่ลงคนละเวลาไม่ถูกจับรวมคันเดียวกัน</p>
        </>
      )}
    </section>
  );
}
