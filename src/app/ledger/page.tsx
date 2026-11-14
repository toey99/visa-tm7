"use client";

// =============================================================
// /ledger — 📒 บัญชีอาเต่า: the agent's running account, one day at a time
// =============================================================
// ยกมา + โอนเข้า + ลูกค้าจ่ายหน้างาน ± ปรับยอด − ค่างานวันนั้น = ยอดยกไป
// Charges come straight off the day boards (extension + visa run) and the
// 90-day inbox, priced with the table in ⚙️; transfers come from the slip room.
// Hand adjustments and a note per day; close the day to freeze it; copy or
// push the closing text to the agent's LINE group.

import { useEffect, useMemo, useState } from "react";
import {
  addDays, bkkToday, closingText, dayTh, money, PRICE_LABELS, signed, type Adjustment, type DayLedger, type LedgerConfig, type Prices,
} from "@/lib/ledger/types";

type Resp = { config: LedgerConfig; days: DayLedger[]; groups: { id: string; name: string }[]; sent?: string; error?: string };
const BOOK = "ARTAO" as const;
const SRC_LABEL = { ext: "ต่อวีซ่า", run: "วีซ่ารัน", d90: "90 วัน" } as const;
const OFFICE_SHORT: Record<string, string> = { BANGKOK: "IT", NONTHABURI: "นนท์", RAYONG: "ระยอง", CHIANG_SAEN: "เชียงแสน", VFS_BANGKOK: "VFS กทม.", VFS_PATTAYA: "VFS พัทยา" };

export default function LedgerPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [day, setDay] = useState(bkkToday());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [showCfg, setShowCfg] = useState(false);
  const [note, setNote] = useState("");
  const [adjs, setAdjs] = useState<Adjustment[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newAmount, setNewAmount] = useState("");

  const d = useMemo(() => data?.days.find((x) => x.day === day) ?? null, [data, day]);
  useEffect(() => { if (d) { setNote(d.note); setAdjs(d.adjustments); } }, [d]);

  async function call(body?: Record<string, unknown>, label = "กำลังโหลด…") {
    setBusy(label); setError("");
    try {
      const to = day > bkkToday() ? day : bkkToday();
      const r = body
        ? await fetch("/api/ledger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ book: BOOK, ...body }) })
        : await fetch(`/api/ledger?book=${BOOK}&to=${to}`, { cache: "no-store" });
      const j = (await r.json()) as Resp;
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
      return j;
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return null; }
    finally { setBusy(""); }
  }
  useEffect(() => { void call(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const saveEdits = (patch: Record<string, unknown>) => call({ day, ...patch }, "กำลังบันทึก…");
  async function addAdj() {
    const amount = Number(newAmount.replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(amount) || !amount) return;
    const next = [...adjs, { id: Date.now().toString(36), label: newLabel.trim(), amount }];
    setAdjs(next); setNewLabel(""); setNewAmount("");
    await saveEdits({ adjustments: next });
  }
  async function removeAdj(id: string) { const next = adjs.filter((a) => a.id !== id); setAdjs(next); await saveEdits({ adjustments: next }); }
  async function copyText() {
    if (!d) return;
    try { await navigator.clipboard.writeText(closingText(BOOK, d)); setBusy("ก๊อปข้อความแล้ว วางใน LINE ได้เลย"); setTimeout(() => setBusy(""), 2000); }
    catch { setError("ก๊อปไม่ได้ — เบราว์เซอร์ไม่อนุญาต"); }
  }
  async function sendLine() {
    if (!d) return;
    if (!confirm(`ส่งยอดตัดจบ ${dayTh(day)} เข้ากลุ่ม LINE ของอาเต่า?`)) return;
    const j = await call({ day, note, send: true }, "กำลังส่งเข้า LINE…");
    if (j?.sent) { setBusy("ส่งเข้า LINE แล้ว ✅"); setTimeout(() => setBusy(""), 2500); }
  }

  const days = data?.days ?? [];
  const recent = days.slice(-10).reverse();
  const cfg = data?.config;

  return (
    <main className="mx-auto max-w-3xl p-3 sm:p-5">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-emerald-700">📒 บัญชีอาเต่า</h1>
        <div className="ml-auto flex items-center gap-1">
          <button className="btn" onClick={() => setDay(addDays(day, -1))}>‹</button>
          <input type="date" className="inp" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} />
          <button className="btn" onClick={() => setDay(addDays(day, 1))}>›</button>
          <button className="btn" onClick={() => void call()} title="โหลดใหม่">🔄</button>
          <button className="btn" onClick={() => setShowCfg((v) => !v)}>⚙️</button>
        </div>
      </header>

      {error && <div className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {busy && <div className="mb-3 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">{busy}</div>}

      {showCfg && cfg && <ConfigPanel cfg={cfg} groups={data?.groups ?? []} onSave={(c) => call({ config: c }, "กำลังบันทึกราคา…")} />}

      {d && (
        <>
          {/* the day in one glance */}
          <section className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="ยกมา" value={money(d.carryIn)} tone={d.carryIn < 0 ? "bad" : "mute"} />
            <Stat label="เงินเข้า" value={`+${money(d.creditTotal + d.adjustTotal)}`} tone="good" />
            <Stat label="ค่างาน" value={`−${money(d.chargeTotal)}`} tone="warn" />
            <Stat label="ยกไป" value={money(d.carryOut)} tone={d.carryOut < 0 ? "bad" : "good"} big />
          </section>
          {d.closedAt && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">🔒 ปิดยอดวันนี้แล้ว (ตัวเลขถูกตรึงไว้ ไม่อ่านจากบอร์ดอีก) <button className="ml-2 underline" onClick={() => void saveEdits({ reopen: true })}>เปิดใหม่</button></div>}

          {/* money in */}
          <Card title={`💰 เงินเข้า · ${d.credits.length} รายการ`} right={`+${money(d.creditTotal)}`}>
            {d.credits.length === 0 && <p className="text-sm text-slate-400">ยังไม่มีสลิปโอนของรอบนี้</p>}
            {d.credits.map((c) => (
              <Row key={c.id} left={<span>{c.kind === "slip" ? "🧾" : "💵"} {c.label}{c.time ? <span className="text-slate-400"> · {c.time}</span> : null}</span>} right={`+${money(c.amount)}`} />
            ))}
          </Card>

          {/* charges */}
          <Card title={`🧮 ค่างาน · ${d.charges.length} รายการ`} right={`−${money(d.chargeTotal)}`}>
            {d.charges.length === 0 && <p className="text-sm text-slate-400">ไม่มีงานของอาเต่าในบอร์ดวันนี้</p>}
            {d.charges.map((c) => (
              <Row
                key={`${c.src}-${c.id}`}
                left={<span><span className="mr-1 rounded bg-slate-100 px-1 text-[11px] text-slate-600">{SRC_LABEL[c.src]}{c.office ? ` ${OFFICE_SHORT[c.office] ?? c.office}` : ""}</span>{c.name} {c.flags}<span className="block text-xs text-slate-400">{c.passport} · {c.items.map((i) => `${i.label} ${money(i.amount)}`).join(" + ")}</span></span>}
                right={money(c.amount)}
              />
            ))}
          </Card>

          {/* adjustments */}
          <Card title="✏️ ปรับยอดด้วยมือ" right={adjs.length ? signed(d.adjustTotal) : ""}>
            {adjs.map((a) => <Row key={a.id} left={<span>{a.label || "ปรับยอด"} <button className="ml-1 text-xs text-rose-500" onClick={() => void removeAdj(a.id)}>ลบ</button></span>} right={signed(a.amount)} />)}
            <div className="mt-2 flex flex-wrap gap-1">
              <input className="inp flex-1" placeholder="รายการ เช่น คืนเงิน / ค่าเอกสาร" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
              <input className="inp w-28" inputMode="numeric" placeholder="+เข้า / −หัก" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} />
              <button className="btn" onClick={() => void addAdj()}>เพิ่ม</button>
            </div>
            <p className="mt-1 text-[11px] text-slate-400">ใส่เลขบวก = เงินเข้า/เครดิตให้อาเต่า · เลขลบ (เช่น -500) = หักเพิ่ม</p>
          </Card>

          <Card title="📝 หมายเหตุ">
            <textarea className="inp h-16 w-full" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== d.note && void saveEdits({ note })} placeholder="เช่น รอสลิปอีก 1 ใบ / คิดราคาพิเศษ…" />
          </Card>

          <div className="mb-4 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => void copyText()}>📋 ข้อความตัดจบ</button>
            <button className="btn-primary" onClick={() => void sendLine()}>📲 ตัดจบ → LINE</button>
            {!d.closedAt && <button className="btn" onClick={() => void saveEdits({ close: true })}>🔒 ปิดยอดวัน</button>}
          </div>

          <pre className="mb-4 whitespace-pre-wrap rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">{closingText(BOOK, d)}</pre>
        </>
      )}

      {!d && data && <p className="mb-4 text-sm text-slate-500">ยังไม่มีข้อมูลของวัน {dayTh(day)} — บัญชีเริ่มที่ {dayTh(cfg?.opening.day ?? day)} (ตั้งยอดเริ่มต้นได้ใน ⚙️)</p>}

      {/* recent days */}
      {recent.length > 0 && (
        <Card title="📆 ย้อนหลัง">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-400"><th>วัน</th><th className="text-right">ยกมา</th><th className="text-right">เข้า</th><th className="text-right">ค่างาน</th><th className="text-right">ยกไป</th></tr></thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.day} className={`cursor-pointer border-t border-slate-100 ${r.day === day ? "bg-emerald-50" : "hover:bg-slate-50"}`} onClick={() => setDay(r.day)}>
                  <td className="py-1">{dayTh(r.day)} {r.closedAt ? "🔒" : ""}</td>
                  <td className="text-right tabular-nums">{money(r.carryIn)}</td>
                  <td className="text-right tabular-nums text-emerald-700">+{money(r.creditTotal + r.adjustTotal)}</td>
                  <td className="text-right tabular-nums text-amber-700">−{money(r.chargeTotal)}</td>
                  <td className={`text-right font-semibold tabular-nums ${r.carryOut < 0 ? "text-rose-600" : "text-slate-800"}`}>{money(r.carryOut)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <style>{`
        .inp { border: 1px solid #e2e8f0; border-radius: .5rem; padding: .35rem .5rem; font-size: .875rem; background: #fff; }
        .btn { border: 1px solid #e2e8f0; border-radius: .5rem; padding: .35rem .6rem; font-size: .875rem; background: #fff; }
        .btn:hover { background: #f8fafc; }
        .btn-primary { border-radius: .5rem; padding: .45rem .8rem; font-size: .875rem; font-weight: 600; background: #059669; color: #fff; }
        .btn-primary:hover { background: #047857; }
      `}</style>
    </main>
  );
}

function Stat({ label, value, tone, big }: { label: string; value: string; tone: "good" | "bad" | "warn" | "mute"; big?: boolean }) {
  const color = tone === "good" ? "text-emerald-700 bg-emerald-50" : tone === "bad" ? "text-rose-700 bg-rose-50" : tone === "warn" ? "text-amber-700 bg-amber-50" : "text-slate-700 bg-slate-100";
  return (
    <div className={`rounded-xl px-3 py-2 ${color}`}>
      <div className="text-[11px] opacity-70">{label}</div>
      <div className={`font-bold tabular-nums ${big ? "text-2xl" : "text-lg"}`}>{value}</div>
    </div>
  );
}
function Card({ title, right, children }: { title: string; right?: string; children: React.ReactNode }) {
  return (
    <section className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
      <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold text-slate-700">{title}</h2>{right && <span className="text-sm font-semibold tabular-nums">{right}</span>}</div>
      {children}
    </section>
  );
}
function Row({ left, right }: { left: React.ReactNode; right: string }) {
  return <div className="flex items-start justify-between gap-2 border-t border-slate-100 py-1.5 text-sm first:border-t-0"><div className="min-w-0 flex-1">{left}</div><div className="shrink-0 tabular-nums">{right}</div></div>;
}

function ConfigPanel({ cfg, groups, onSave }: { cfg: LedgerConfig; groups: { id: string; name: string }[]; onSave: (c: { prices: Partial<Prices>; opening: { day: string; amount: number }; lineGroupId: string }) => Promise<unknown> }) {
  const [prices, setPrices] = useState<Prices>(cfg.prices);
  const [openDay, setOpenDay] = useState(cfg.opening.day);
  const [openAmt, setOpenAmt] = useState(String(cfg.opening.amount));
  const [group, setGroup] = useState(cfg.lineGroupId ?? "");
  useEffect(() => { setPrices(cfg.prices); setOpenDay(cfg.opening.day); setOpenAmt(String(cfg.opening.amount)); setGroup(cfg.lineGroupId ?? ""); }, [cfg]);
  return (
    <section className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 text-sm">
      <h2 className="mb-2 font-semibold text-emerald-800">⚙️ ตั้งค่าบัญชี</h2>
      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="block"><span className="text-xs text-slate-500">บัญชีเริ่มวันที่</span><input type="date" className="inp w-full" value={openDay} onChange={(e) => setOpenDay(e.target.value)} /></label>
        <label className="block"><span className="text-xs text-slate-500">ยอดยกมาตอนเริ่ม (บวก = เงินอาเต่าอยู่กับเรา, ลบ = ค้าง)</span><input className="inp w-full" inputMode="numeric" value={openAmt} onChange={(e) => setOpenAmt(e.target.value)} /></label>
        <label className="block"><span className="text-xs text-slate-500">กลุ่ม LINE สำหรับส่งยอดตัดจบ</span>
          <select className="inp w-full" value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="">— ไม่ส่ง —</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {(Object.keys(PRICE_LABELS) as (keyof Prices)[]).map((k) => (
          <label key={k} className="flex items-center justify-between gap-2 rounded-lg bg-white px-2 py-1">
            <span className="text-xs text-slate-600">{PRICE_LABELS[k]}</span>
            {typeof prices[k] === "boolean"
              ? <input type="checkbox" checked={prices[k] as boolean} onChange={(e) => setPrices({ ...prices, [k]: e.target.checked })} />
              : <input className="inp w-24 text-right" inputMode="numeric" value={String(prices[k])} onChange={(e) => setPrices({ ...prices, [k]: Number(e.target.value.replace(/[^\d.]/g, "")) || 0 })} />}
          </label>
        ))}
      </div>
      <button className="btn-primary mt-3" onClick={() => void onSave({ prices, opening: { day: openDay, amount: Number(openAmt.replace(/[^\d.-]/g, "")) || 0 }, lineGroupId: group })}>บันทึกการตั้งค่า</button>
    </section>
  );
}
