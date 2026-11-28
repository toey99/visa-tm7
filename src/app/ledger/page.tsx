"use client";

// =============================================================
// /ledger — 📒 บัญชีอาเต่า: the agent's running account, one day at a time
// =============================================================
// ยกมา + โอนเข้า + ลูกค้าจ่ายหน้างาน ± ปรับยอด − ค่างานวันนั้น = ยอดยกไป
// Charges come straight off the day boards (extension + visa run) and the
// 90-day inbox, priced with the table in ⚙️; transfers come from the slip room.
// Hand adjustments and a note per day; close the day to freeze it; copy or
// push the closing text to the agent's LINE group.

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import ClosingNote from "@/components/ClosingNote";
import { buildSimpleXlsx, captureNode, downloadBlob, jpegPreview } from "@/lib/today/clientTools";
import { chargeKey,
  addDays, bkkToday, buildStatement, closingText, dayShort, dayTh, isLedgerBook, LEDGER_BOOKS, money, PRICE_LABELS, signed, STATEMENT_TEXT, statementTable,
  type Adjustment, type DayLedger, type LedgerBook, type LedgerConfig, type Prices, type Statement,
} from "@/lib/ledger/types";

type Resp = { config: LedgerConfig; days: DayLedger[]; groups: { id: string; name: string }[]; sent?: string; error?: string };
const SRC_LABEL = { ext: "ต่อวีซ่า", run: "วีซ่ารัน", d90: "90 วัน", adv: "สำรองจ่าย" } as const;
const OFFICE_SHORT: Record<string, string> = { BANGKOK: "IT", NONTHABURI: "นนท์", RAYONG: "ระยอง", CHIANG_SAEN: "เชียงแสน", VFS_BANGKOK: "VFS กทม.", VFS_PATTAYA: "VFS พัทยา" };

export default function LedgerPage() {
  // which agent's book: /ledger (อาเต่า) or /ledger?book=UU — read from the URL after mount
  const [bookState, setBookState] = useState<LedgerBook | null>(null);
  useEffect(() => { const b = new URLSearchParams(window.location.search).get("book"); setBookState(isLedgerBook(b) ? b : "ARTAO"); }, []);
  const BOOK: LedgerBook = bookState ?? "ARTAO";
  const bookRef = useRef<LedgerBook>("ARTAO");   // the book on screen now — a slow answer for the other book is dropped
  useEffect(() => { bookRef.current = BOOK; }, [BOOK]);
  const who = LEDGER_BOOKS[BOOK].agent;
  const isStatement = !!LEDGER_BOOKS[BOOK].statement;
  function switchBook(b: LedgerBook) {
    if (b === BOOK) return;
    setData(null); setBookState(b);
    try { window.history.replaceState(null, "", b === "ARTAO" ? "/ledger" : `/ledger?book=${b}`); } catch { /* keep going */ }
  }
  const [data, setData] = useState<Resp | null>(null);
  const [day, setDay] = useState(bkkToday());
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [showCfg, setShowCfg] = useState(false);
  const [note, setNote] = useState("");
  const [adjs, setAdjs] = useState<Adjustment[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [editKey, setEditKey] = useState("");          // the charge line being corrected
  const [editAmount, setEditAmount] = useState("");
  const [editNote, setEditNote] = useState("");
  const noteRef = useRef<HTMLDivElement>(null);

  const d = useMemo(() => data?.days.find((x) => x.day === day) ?? null, [data, day]);
  useEffect(() => { if (d) { setNote(d.note); setAdjs(d.adjustments); } }, [d]);

  async function call(body?: Record<string, unknown>, label = "กำลังโหลด…") {
    setBusy(label); setError("");
    try {
      const to = day > bkkToday() ? day : bkkToday();
      const asked = BOOK;
      const r = body
        ? await fetch("/api/ledger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ book: BOOK, ...body }) })
        : await fetch(`/api/ledger?book=${BOOK}&to=${to}`, { cache: "no-store" });
      const j = (await r.json()) as Resp;
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      if (asked !== bookRef.current) return null;
      setData(j);
      if (j.config?.opening?.day && day < j.config.opening.day) setDay(j.config.opening.day);   // the book opens later than the day shown → jump there
      return j;
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return null; }
    finally { setBusy(""); }
  }
  useEffect(() => { if (bookState) void call(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [bookState]);

  const saveEdits = (patch: Record<string, unknown>) => call({ day, ...patch }, "กำลังบันทึก…");
  // Reopening a locked day re-reads the boards. Ask first, and ask again with the numbers when they would change
  // (an old day's boards may already be cleaned up — its work and counter cash would drop out of the account).
  async function reopenDay() {
    if (!confirm(`เปิดยอดวัน ${dayTh(day)} ใหม่?\nตัวเลขที่ล็อกไว้จะถูกอ่านใหม่จากบอร์ด`)) return;
    setBusy("กำลังตรวจ…"); setError("");
    try {
      const send = (force: boolean) => fetch("/api/ledger", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ book: BOOK, day, reopen: true, force }) });
      let r = await send(false);
      if (r.status === 409) {
        const j = (await r.json()) as { needConfirm?: { was: { charge: number; credit: number }; now: { charge: number; credit: number } } };
        const c = j.needConfirm;
        setBusy("");
        if (!c || !confirm(`⚠ ถ้าเปิดใหม่ ยอดของ ${dayTh(day)} จะเปลี่ยน\n\nค่างาน ${money(c.was.charge)} → ${money(c.now.charge)}\nเงินเข้า ${money(c.was.credit)} → ${money(c.now.credit)}\n\nข้อมูลบอร์ดของวันเก่าอาจถูกล้างไปแล้ว ยอดคงเหลือทุกวันถัดไปจะเปลี่ยนตาม\nยืนยันเปิดใหม่?`)) return;
        setBusy("กำลังบันทึก…");
        r = await send(true);
      }
      if (!r.ok) { const j = (await r.json().catch(() => ({}))) as { error?: string }; throw new Error(j.error || `HTTP ${r.status}`); }
      setBusy("");
      await call();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(""); }
  }
  async function addAdj() {
    const amount = Number(newAmount.replace(/[^\d.-]/g, ""));
    if (!Number.isFinite(amount) || !amount) return;
    const next = [...adjs, { id: Date.now().toString(36), label: newLabel.trim(), amount }];
    setAdjs(next); setNewLabel(""); setNewAmount("");
    await saveEdits({ adjustments: next });
  }
  // Correct one charge line by hand. The whole set of the day's corrections is sent each time,
  // rebuilt from the lines on screen (a corrected line carries `was`).
  async function saveOverride(key: string, amount: number | null, note = "") {
    if (!d) return;
    const all: Record<string, { amount: number; note?: string }> = {};
    for (const c of d.charges) if (c.was !== undefined) all[chargeKey(c)] = { amount: c.amount, note: c.editNote };
    if (amount === null) delete all[key]; else all[key] = { amount, note };
    setEditKey("");
    await saveEdits({ overrides: all });
  }
  async function removeAdj(id: string) { const next = adjs.filter((a) => a.id !== id); setAdjs(next); await saveEdits({ adjustments: next }); }
  async function copyText() {
    if (!d) return;
    try { await navigator.clipboard.writeText(closingText(BOOK, d)); setBusy("ก๊อปข้อความแล้ว วางใน LINE ได้เลย"); setTimeout(() => setBusy(""), 2000); }
    catch { setError("ก๊อปไม่ได้ — เบราว์เซอร์ไม่อนุญาต"); }
  }
  async function makePng(): Promise<Blob | null> {
    const el = noteRef.current; if (!el) return null;
    return captureNode(el);
  }
  async function exportPng() {
    if (!d) return;
    setBusy("กำลังทำรูป…"); setError("");
    try { const b = await makePng(); if (!b) throw new Error("ทำรูปไม่สำเร็จ"); downloadBlob(b, `ตัดยอด${who}_${dayTh(day).replace(/\//g, "")}.png`); setBusy(""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(""); }
  }
  async function sendLine() {
    if (!d) return;
    if (!confirm(`ส่งรูปตัดยอด ${dayTh(day)} เข้ากลุ่ม LINE ของ${who}?`)) return;
    setBusy("กำลังส่งเข้า LINE…"); setError("");
    try {
      if (note !== d.note) await call({ day, note }, "กำลังบันทึก…");
      const b = await makePng(); if (!b) throw new Error("ทำรูปไม่สำเร็จ");
      const fd = new FormData();
      fd.set("book", BOOK); fd.set("day", day);
      fd.set("img", new File([b], "closing.png", { type: "image/png" }));
      try { fd.set("prev", new File([await jpegPreview(b)], "closing-p.jpg", { type: "image/jpeg" })); } catch { /* full picture doubles as preview */ }
      const r = await fetch("/api/ledger/send", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setBusy("ส่งรูปเข้า LINE แล้ว ✅"); setTimeout(() => setBusy(""), 2500);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(""); }
  }

  // ---------- statement (对账单) for books whose agent reads Chinese / English ----------
  const stRef = useRef<HTMLDivElement>(null);
  const [stFrom, setStFrom] = useState("");
  const openDay = data?.config.opening.day ?? "";
  const from = stFrom && stFrom >= openDay ? stFrom : openDay;
  const statement = useMemo(() => (isStatement && data && from && day >= from ? buildStatement(data.days, from, day, LEDGER_BOOKS[BOOK].lang ?? "zh") : null), [isStatement, data, from, day, BOOK]);
  async function statementPng() {
    if (!statement || !stRef.current) return;
    setBusy("กำลังทำรูปใบแจ้งยอด…"); setError("");
    try { const b = await captureNode(stRef.current); if (!b) throw new Error("ทำรูปไม่สำเร็จ"); downloadBlob(b, `statement_${who}_${statement.from}_${statement.to}.png`); setBusy(""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(""); }
  }
  async function statementXlsx() {
    if (!statement) return;
    setBusy("กำลังทำ Excel…"); setError("");
    try { downloadBlob(await buildSimpleXlsx(statementTable(who, statement), "Statement", [12, 28, 24, 44, 12, 12, 16]), `statement_${who}_${statement.from}_${statement.to}.xlsx`); setBusy(""); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(""); }
  }
  async function statementCopy() {
    if (!statement) return;
    try { await navigator.clipboard.writeText(statementTable(who, statement).map((r) => r.join("\t")).join("\n")); setBusy("ก๊อปแล้ว วางใน WeChat / Excel ได้เลย"); setTimeout(() => setBusy(""), 2000); }
    catch { setError("ก๊อปไม่ได้ — เบราว์เซอร์ไม่อนุญาต"); }
  }

  const [previewScale, setPreviewScale] = useState(0.5);
  const [noteHeight, setNoteHeight] = useState(0);
  useEffect(() => {
    const fit = () => { const w = Math.min(window.innerWidth - 40, 720); setPreviewScale(w / 720); setNoteHeight((isStatement ? stRef.current?.offsetHeight : noteRef.current?.offsetHeight) ?? 0); };
    fit(); window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit);
  }, [d, note, isStatement, statement]);

  const days = data?.days ?? [];
  const recent = days.slice(-10).reverse();
  const cfg = data?.config;

  return (
    <main className="mx-auto max-w-3xl p-3 sm:p-5">
      <header className="mb-3 flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-bold text-emerald-700">📒 บัญชี</h1>
        <div className="flex gap-1">
          {(Object.keys(LEDGER_BOOKS) as LedgerBook[]).map((b) => (
            <button key={b} onClick={() => switchBook(b)} className={`rounded-full px-3 py-1 text-sm font-semibold ${b === BOOK ? (b === "UU" ? "bg-sky-500 text-white" : b === "NUNA" ? "bg-pink-500 text-white" : "bg-emerald-600 text-white") : "border border-slate-200 bg-white text-slate-600"}`}>{LEDGER_BOOKS[b].agent}</button>
          ))}
        </div>
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
          {d.closedAt && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs text-emerald-700">🔒 ปิดยอดวันนี้แล้ว (ตัวเลขถูกตรึงไว้ ไม่อ่านจากบอร์ดอีก) <button className="ml-2 underline" onClick={() => void reopenDay()}>เปิดใหม่</button></div>}
          {!d.closedAt && d.backupAt && <div className="mb-3 rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-800">⚠ วันนี้ถูกเปิดใหม่ — ตัวเลขอ่านสดจากบอร์ด (ยอดที่ล็อกไว้เดิมยังเก็บอยู่) <button className="ml-2 font-semibold underline" onClick={() => { if (confirm(`คืนยอดของ ${dayTh(day)} กลับเป็นชุดที่ล็อกไว้เดิม?`)) void saveEdits({ restore: true }); }}>↩ คืนยอดที่ล็อกไว้เดิม</button></div>}

          {/* money in */}
          <Card title={`💰 เงินเข้า · ${d.credits.length} รายการ`} right={`+${money(d.creditTotal)}`}>
            {d.credits.length === 0 && <p className="text-sm text-slate-400">{isStatement ? `ยังไม่มีเงินเข้า — เงินโอนของ ${who} ให้ลงในช่องปรับยอดด้านล่าง (เลขบวก)` : "ยังไม่มีสลิปโอนของรอบนี้"}</p>}
            {d.credits.map((c) => (
              <Row key={c.id} left={<span>{c.kind === "slip" ? "🧾" : "💵"} {c.label}{c.time ? <span className="text-slate-400"> · {c.time}</span> : null}</span>} right={`+${money(c.amount)}`} />
            ))}
          </Card>

          {/* charges */}
          <Card title={`🧮 ค่างาน · ${d.charges.length} รายการ`} right={`−${money(d.chargeTotal)}`}>
            {d.charges.length === 0 && <p className="text-sm text-slate-400">ไม่มีงานของ{who}ในบอร์ดวันนี้</p>}
            {d.charges.map((c) => (
              <Row
                key={`${c.src}-${c.id}`}
                left={<span><span className="mr-1 rounded bg-slate-100 px-1 text-[11px] text-slate-600">{SRC_LABEL[c.src]}{c.office ? ` ${OFFICE_SHORT[c.office] ?? c.office}` : ""}</span>{isStatement && c.cn ? `${c.cn} ` : ""}{c.name} {c.flags}<span className="block text-xs text-slate-400">{c.passport} · {c.items.map((i) => `${i.label} ${money(i.amount)}`).join(" + ")}</span></span>}
                right={money(c.amount)}
                below={editKey === chargeKey(c) ? (
                  <div className="mt-1 flex flex-wrap items-center gap-1 rounded-lg bg-amber-50 p-1.5">
                    <span className="text-xs text-slate-500">ยอดที่คิดได้ {money(c.was ?? c.amount)} → แก้เป็น</span>
                    <input className="inp w-24" inputMode="numeric" autoFocus value={editAmount} onChange={(e) => setEditAmount(e.target.value)} placeholder="ยอดใหม่" />
                    <input className="inp min-w-0 flex-1" value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="เหตุผล (ขึ้นในใบสรุป) เช่น ส่วนลด" />
                    <button className="btn" onClick={() => { const n = Number(editAmount.replace(/[^\d.]/g, "")); if (editAmount.trim() !== "" && Number.isFinite(n)) void saveOverride(chargeKey(c), n, editNote.trim()); }}>บันทึก</button>
                    {c.was !== undefined && <button className="text-xs text-rose-500 underline" onClick={() => void saveOverride(chargeKey(c), null)}>คืนยอดเดิม {money(c.was)}</button>}
                    <button className="text-xs text-slate-400 underline" onClick={() => setEditKey("")}>ยกเลิก</button>
                  </div>
                ) : (
                  <button className="text-xs text-sky-600 underline" onClick={() => { setEditKey(chargeKey(c)); setEditAmount(String(c.amount)); setEditNote(c.editNote ?? ""); }}>{c.was !== undefined ? `✏️ แก้แล้ว (เดิม ${money(c.was)}) · แก้อีก` : "แก้ยอด"}</button>
                )}
              />
            ))}
          </Card>

          {/* adjustments */}
          <Card title="✏️ ปรับยอดด้วยมือ" right={adjs.length ? signed(d.adjustTotal) : ""}>
            {adjs.map((a) => <Row key={a.id} left={<span>{a.label || "ปรับยอด"} <button className="ml-1 text-xs text-rose-500" onClick={() => void removeAdj(a.id)}>ลบ</button></span>} right={signed(a.amount)} />)}
            <div className="mt-2 flex flex-wrap gap-1">
              <input className="inp flex-1" placeholder={LEDGER_BOOKS[BOOK].lang === "zh" ? "รายการ (พิมพ์จีน/อังกฤษ — ขึ้นในใบ 对账单) เช่น 转账 Transfer" : isStatement ? "รายการ เช่น โอนเข้า / ฝากทำเอกสาร" : "รายการ เช่น คืนเงิน / ค่าเอกสาร"} value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
              <input className="inp w-28" inputMode="numeric" placeholder="+เข้า / −หัก" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} />
              <button className="btn" onClick={() => void addAdj()}>เพิ่ม</button>
            </div>
            {(LEDGER_BOOKS[BOOK].quick ?? []).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {(LEDGER_BOOKS[BOOK].quick ?? []).map((q) => (
                  <button key={q.label} className="rounded-full border border-pink-200 bg-pink-50 px-2.5 py-1 text-xs font-semibold text-pink-700" title={`เพิ่มบรรทัด ${signed(q.amount)} — เครดิตให้${who}`}
                    onClick={() => { const next = [...adjs, { id: Date.now().toString(36), label: q.label, amount: q.amount }]; setAdjs(next); void saveEdits({ adjustments: next }); }}>+ {q.label} {money(q.amount)}</button>
                ))}
              </div>
            )}
            <p className="mt-1 text-[11px] text-slate-400">ใส่เลขบวก = เงินเข้า/เครดิตให้{who} · เลขลบ (เช่น -500) = หักเพิ่ม</p>
          </Card>

          <Card title="📝 หมายเหตุ">
            <textarea className="inp h-16 w-full" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== d.note && void saveEdits({ note })} placeholder="เช่น รอสลิปอีก 1 ใบ / คิดราคาพิเศษ…" />
          </Card>

          {!isStatement && (<>
          <div className="mb-4 flex flex-wrap gap-2">
            <button className="btn-primary" onClick={() => void exportPng()}>🖼 รูปตัดยอด</button>
            <button className="btn-primary" onClick={() => void sendLine()}>📲 รูปตัดยอด → LINE</button>
            <button className="btn" onClick={() => void copyText()}>📋 ก๊อปข้อความ</button>
            {!d.closedAt && <button className="btn" onClick={() => void saveEdits({ close: true })}>🔒 ปิดยอดวัน</button>}
          </div>

          {/* on-screen preview scaled to fit; the full-size copy below (off-screen) is what gets captured */}
          <div className="mb-4 w-full overflow-hidden rounded-xl border border-slate-200" style={{ aspectRatio: `720 / ${noteHeight || 720}` }}>
            <div style={{ transform: `scale(${previewScale})`, transformOrigin: "top left", width: 720 }}>
              <ClosingNote text={closingText(BOOK, d)} negative={d.carryOut < 0} />
            </div>
          </div>
          <div style={{ position: "absolute", left: -10000, top: 0 }} aria-hidden>
            <ClosingNote ref={noteRef} text={closingText(BOOK, d)} negative={d.carryOut < 0} />
          </div>
          </>)}

          {isStatement && (<>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-sky-700">🧾 {statement ? STATEMENT_TEXT[statement.lang].title : "Statement"}</span>
              <label className="flex items-center gap-1 text-xs text-slate-500">ตั้งแต่ <input type="date" className="inp" min={openDay} max={day} value={from} onChange={(e) => setStFrom(e.target.value)} /></label>
              <span className="text-xs text-slate-500">ถึง {dayTh(day)}</span>
            </div>
            <div className="mb-4 flex flex-wrap gap-2">
              <button className="btn-sky" disabled={!statement} onClick={() => void statementPng()}>🖼 รูปใบแจ้งยอด</button>
              <button className="btn-sky" disabled={!statement} onClick={() => void statementXlsx()}>⬇ Excel</button>
              <button className="btn" disabled={!statement} onClick={() => void statementCopy()}>📋 ก๊อปตาราง</button>
              {!d.closedAt && <button className="btn" onClick={() => void saveEdits({ close: true })}>🔒 ปิดยอดวัน</button>}
            </div>
            {statement && (<>
              <div className="mb-4 w-full overflow-hidden rounded-xl border border-slate-200" style={{ aspectRatio: `720 / ${noteHeight || 720}` }}>
                <div style={{ transform: `scale(${previewScale})`, transformOrigin: "top left", width: 720 }}>
                  <StatementSheet agent={who} s={statement} />
                </div>
              </div>
              <div style={{ position: "absolute", left: -10000, top: 0 }} aria-hidden>
                <StatementSheet ref={stRef} agent={who} s={statement} />
              </div>
            </>)}
          </>)}
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
        .btn-sky { border-radius: .5rem; padding: .45rem .8rem; font-size: .875rem; font-weight: 600; background: #0ea5e9; color: #fff; }
        .btn-sky:hover { background: #0284c7; }
        .btn-sky:disabled { background: #cbd5e1; }
      `}</style>
    </main>
  );
}

// 对账单 — the period statement sent to an agent who reads Chinese / English (PNG via captureNode)
const StatementSheet = forwardRef<HTMLDivElement, { agent: string; s: Statement }>(function StatementSheet({ agent, s }, ref) {
  const font = "system-ui, 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans Thai', 'Segoe UI Emoji', sans-serif";
  const cols = "62px 1.25fr 1.5fr 84px 84px 96px";
  const cell: React.CSSProperties = { padding: "7px 8px", fontSize: 15, lineHeight: 1.25, minWidth: 0, overflowWrap: "anywhere" };
  const numCell: React.CSSProperties = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  const thCell: React.CSSProperties = { padding: "8px 8px", fontSize: 13, fontWeight: 800, color: "#0c4a6e", lineHeight: 1.2 };
  const dueText = (n: number) => (n < 0 ? `−${money(-n)}` : money(n));
  const T = STATEMENT_TEXT[s.lang];
  const th = s.lang === "th";
  const head = (x: string, right = false) => <div style={{ ...thCell, textAlign: right ? "right" : "left", whiteSpace: "pre-line" }}>{x}</div>;
  const total = (label: string, value: string, bg: string, fg: string, big = false) => (
    <div style={{ flex: big ? 1.3 : 1, background: bg, color: fg, borderRadius: 12, padding: "9px 12px" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, opacity: 0.85 }}>{label}</div>
      <div style={{ fontSize: big ? 28 : 21, fontWeight: 900, fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{value}</div>
    </div>
  );
  return (
    <div ref={ref} style={{ width: 720, padding: 18, background: "linear-gradient(135deg,#e0f2fe,#fdf2f8 55%,#fef9c3)", fontFamily: font, boxSizing: "border-box", color: "#0f172a" }}>
      <div style={{ background: "#0ea5e9", color: "#fff", borderRadius: 14, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", boxShadow: "0 4px 14px rgba(14,165,233,.3)" }}>
        <div>
          <div style={{ fontSize: 25, fontWeight: 900, lineHeight: 1.15 }}>{T.title}</div>
          <div style={{ fontSize: 15, fontWeight: 600, opacity: 0.95 }}>{dayTh(s.from)} – {dayTh(s.to)} · THB</div>
        </div>
        <div style={{ fontSize: 26, fontWeight: 900, background: "rgba(255,255,255,.22)", borderRadius: 10, padding: "4px 14px" }}>{agent}</div>
      </div>

      <div style={{ marginTop: 12, background: "#fff", borderRadius: 12, overflow: "hidden", boxShadow: "0 2px 10px rgba(0,0,0,.06)" }}>
        <div style={{ display: "grid", gridTemplateColumns: cols, background: "#bae6fd" }}>
          {head(T.date)}{head(T.client)}{head(T.service)}{head(T.fee, true)}{head(T.received, true)}{head(T.balance, true)}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: cols, background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
          <div style={cell} /><div style={{ ...cell, fontWeight: 700, gridColumn: "2 / span 4" }}>{T.previous}</div><div style={{ ...numCell, fontWeight: 800 }}>{dueText(s.openingDue)}</div>
        </div>
        {s.rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: cols, background: r.kind === "payment" ? "#dcfce7" : i % 2 ? "#f8fafc" : "#fff", borderBottom: "1px solid #eef2f7" }}>
            <div style={{ ...cell, color: "#475569" }}>{dayShort(r.day)}</div>
            <div style={cell}><span style={{ fontWeight: 700, fontSize: 16 }}>{r.client}</span>{r.sub ? <span style={{ display: "block", fontSize: 12, color: "#64748b" }}>{r.sub}</span> : null}</div>
            <div style={{ ...cell, fontSize: 13.5, color: "#334155" }}>{r.service}</div>
            <div style={numCell}>{r.fee ? money(r.fee) : ""}</div>
            <div style={{ ...numCell, color: "#15803d", fontWeight: r.received ? 700 : 400 }}>{r.received ? money(r.received) : ""}</div>
            <div style={{ ...numCell, fontWeight: 700, color: r.due < 0 ? "#15803d" : "#0f172a" }}>{dueText(r.due)}</div>
          </div>
        ))}
        {s.rows.length === 0 && <div style={{ ...cell, textAlign: "center", color: "#94a3b8", padding: 18 }}>{T.empty}</div>}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        {total(T.totalFees, money(th ? s.fees - s.tickets : s.fees), "#fef3c7", "#92400e")}
        {(th || s.tickets > 0) && total(T.tickets, money(s.tickets), "#cffafe", "#155e75")}
        {total(T.totalReceived, money(s.received), "#dcfce7", "#166534")}
        {s.due < 0
          ? total(T.credit, `${money(-s.due)} THB`, "#bbf7d0", "#14532d", true)
          : total(T.due, `${money(s.due)} THB`, s.due > 0 ? "#fbcfe8" : "#bbf7d0", s.due > 0 ? "#9d174d" : "#14532d", true)}
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "#64748b", textAlign: "center" }}>{T.formula}</div>
    </div>
  );
});

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
function Row({ left, right, below }: { left: React.ReactNode; right: string; below?: React.ReactNode }) {
  return <div className="flex items-start justify-between gap-2 border-t border-slate-100 py-1.5 text-sm first:border-t-0"><div className="min-w-0 flex-1">{left}{below}</div><div className="shrink-0 tabular-nums">{right}</div></div>;
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
        <label className="block"><span className="text-xs text-slate-500">ยอดยกมาตอนเริ่ม (บวก = เงินเอเย่นต์อยู่กับเรา, ลบ = เอเย่นต์ค้าง)</span><input className="inp w-full" inputMode="numeric" value={openAmt} onChange={(e) => setOpenAmt(e.target.value)} /></label>
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
