"use client";

// =============================================================
// RecoverPanel — 🧰 กู้ข้อมูล
// =============================================================
// Shows everything the server still holds for the open date: the legacy
// (pre office-split) index, each office's index, and orphan folders whose
// files are not referenced by any index. Each person can be pulled onto the
// board that is open right now; orphan files are re-read like a fresh drop.

import { useEffect, useState } from "react";
import { OFFICES, type OfficeId } from "@/lib/offices";

type RecPerson = { id: string; order?: number; fields?: Record<string, string>; files: { path: string; kind?: string }[]; photo?: string; cancelled?: boolean; movedTo?: string; filesTotal?: number; filesPresent?: number };
type Source = { source: string; office: string; savedAt: string; people: RecPerson[] };
type Orphan = { where: string; personId: string; files: string[]; updated: string };

const label = (o: string) => (o in OFFICES ? OFFICES[o as OfficeId].label : o || "(ไม่ระบุ)");

export default function RecoverPanel({ ns, date, office, currentIds, onImportRef, onImportFiles, onClose }: {
  ns: "days" | "run"; date: string; office: string; currentIds: Set<string>;
  onImportRef: (ref: unknown, targetOffice: string) => Promise<void>; onImportFiles: (paths: string[]) => Promise<void>; onClose: () => void;
}) {
  // where imports go: defaults to the board that is open; can be any office
  const [target, setTarget] = useState(office);
  const [done, setDone] = useState<Record<string, string>>({});   // personId → office it was sent to (this session)
  const [data, setData] = useState<{ sources: Source[]; orphans: Orphan[]; total: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const day = date.replace(/\//g, "");

  async function load() {
    setError(""); setData(null);
    try {
      const r = await fetch(`/api/day/recover?ns=${ns}&date=${day}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({ error: `HTTP ${r.status}` }))).error);
      setData(await r.json());
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setData({ sources: [], orphans: [], total: 0 }); }
  }
  useEffect(() => { void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ns, day]);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key); setError("");
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(""); }
  }
  const name = (p: RecPerson) => [p.fields?.firstName, p.fields?.lastName].filter(Boolean).join(" ") || p.id.slice(0, 8);

  return (
    <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-semibold text-amber-900">🧰 กู้ข้อมูลวันที่ {date} — ทุกอย่างที่เซิร์ฟเวอร์ยังเก็บไว้</div>
          <div className="text-xs text-amber-800">คัดลอกคนไปไว้ที่หน้างาน (ของเดิมไม่ถูกลบ):
            <select value={target} onChange={(e) => setTarget(e.target.value)} className="ml-1 rounded-md border border-amber-300 bg-white px-2 py-1 text-sm font-semibold text-slate-800">
              {Object.keys(OFFICES).map((o) => <option key={o} value={o}>{label(o)}{o === office ? " (หน้านี้)" : ""}</option>)}
            </select>
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void load()} className={btn}>↻</button>
          <button type="button" onClick={onClose} className={btn}>ปิด</button>
        </div>
      </div>
      {data && (() => {
        // one tap: everything that has no board of its own — legacy people not on
        // this board yet + every orphan folder (re-read). Other offices' own
        // boards are left alone (they are not lost, just elsewhere).
        const legacyPeople = data.sources.filter((s) => s.source === "legacy").flatMap((s) => s.people).filter((p) => !p.cancelled && !p.movedTo && !currentIds.has(p.id));
        const orphanDocs = data.orphans.map((o) => o.files.filter((f) => /\/doc-/.test(f))).filter((d) => d.length);
        const n = legacyPeople.length + orphanDocs.length;
        if (!n) return null;
        return (
          <button type="button" disabled={!!busy} className={btnPrimary + " mt-3 w-full py-3 text-base"}
            onClick={() => run("all", async () => {
              for (const p of legacyPeople) { await onImportRef(p, target); setDone((d) => ({ ...d, [p.id]: target })); }
              for (const d of orphanDocs) await onImportFiles(d);
              await load();
            })}>
            {busy === "all" ? "กำลังดึง… อย่าเพิ่งปิดหน้า" : `⬇ ดึงทุกอย่างที่กู้ได้ไป ${label(target)} (${legacyPeople.length} คนจากสำเนาเก่า + ${orphanDocs.length} โฟลเดอร์รูปไร้ชื่อ)`}
          </button>
        );
      })()}
      {error && <div className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-red-800">{error}</div>}
      {!data && !error && <div className="mt-3 text-slate-500">กำลังค้นหา…</div>}
      {data && (
        <div className="mt-3 space-y-3">
          {data.sources.length === 0 && data.orphans.length === 0 && <div className="text-slate-600">ไม่พบข้อมูลอื่นของวันนี้บนเซิร์ฟเวอร์ ({data.total} ไฟล์)</div>}
          {data.sources.map((s) => {
            const live = s.people.filter((p) => !p.cancelled && !p.movedTo);
            const importable = live.filter((p) => !currentIds.has(p.id));
            return (
              <div key={s.source} className="rounded-xl bg-white p-3 ring-1 ring-amber-200">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-semibold">{s.source === "legacy" ? "📦 สำเนาเก่า (ก่อนแยกหน้างาน)" : `🏛 หน้างาน ${label(s.source)}`}</span>
                    <span className="ml-2 text-xs text-slate-500">บันทึกเป็น {label(s.office)} · {s.savedAt ? new Date(s.savedAt).toLocaleString("th-TH") : "—"} · {live.length} คน</span>
                  </div>
                  {live.length > 0 && s.source !== target && (
                    <button type="button" disabled={!!busy} onClick={() => run(s.source, async () => { for (const p of live) { await onImportRef(p, target); setDone((d) => ({ ...d, [p.id]: target })); } })} className={btnPrimary}>
                      {busy === s.source ? "กำลังดึง…" : `⬇ ดึงทั้งหมด ${live.length} คนไป ${label(target)}`}
                    </button>
                  )}
                </div>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {live.map((p) => {
                    const here = currentIds.has(p.id);
                    return (
                      <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1">
                        <span className="truncate">
                          <span className="font-mono font-semibold">{name(p)}</span>
                          {p.fields?.chineseName && <span className="ml-1 text-slate-600">{p.fields.chineseName}</span>}
                          {p.fields?.agent && <span className="ml-1 text-xs text-indigo-700">🏢 {p.fields.agent}</span>}
                          {(() => { const t = p.filesTotal ?? p.files.length; const ok = p.filesPresent ?? t; return (
                            <span className={`ml-1 text-xs ${ok === t ? "text-slate-400" : ok === 0 ? "text-red-600 font-semibold" : "text-amber-700 font-semibold"}`}>
                              {ok === t ? `📎 ${t} ไฟล์ ✅` : ok === 0 ? `⚠ ไฟล์หายทั้งหมด (${t})` : `⚠ ไฟล์อยู่ ${ok}/${t}`}
                            </span>
                          ); })()}
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
                          {done[p.id] && <span className="text-xs text-emerald-700">✓ ไป {label(done[p.id])}</span>}
                          {!done[p.id] && here && target === office && <span className="text-xs text-emerald-700">อยู่หน้านี้แล้ว</span>}
                          {s.source !== target && (
                            <button type="button" disabled={!!busy} onClick={() => run(p.id, async () => { await onImportRef(p, target); setDone((d) => ({ ...d, [p.id]: target })); })} className={btn + " px-2 py-0.5 text-xs"} title={`คัดลอกคนนี้พร้อมรูปไป ${label(target)}`}>
                              {busy === p.id ? "…" : here && target === office ? "🔄 ดึงรูปซ้ำ" : `→ ${label(target)}`}
                            </button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
          {data.orphans.length > 0 && (
            <div className="rounded-xl bg-white p-3 ring-1 ring-amber-200">
              <div className="font-semibold">🗂 ไฟล์ที่ไม่มีชื่ออ้างอิงแล้ว ({data.orphans.length} โฟลเดอร์)</div>
              <div className="text-xs text-slate-500">ชื่อ/ข้อมูลหายไปกับสารบัญ แต่รูปยังอยู่ — ดึงมาแล้วระบบจะอ่านพาสปอร์ต/ตราใหม่ให้เหมือนโยนรูปเข้ามาใหม่</div>
              <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                {data.orphans.map((o) => {
                  const docs = o.files.filter((f) => /\/doc-/.test(f));
                  return (
                    <li key={`${o.where}/${o.personId}`} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1">
                      <span className="truncate text-xs">
                        <span className="font-mono">{o.personId.slice(0, 8)}</span> · {o.where === "legacy" ? "สำเนาเก่า" : label(o.where)} · {docs.length} เอกสาร{o.files.length - docs.length > 0 ? ` +${o.files.length - docs.length} รูปที่ทำแล้ว` : ""} · {new Date(o.updated).toLocaleString("th-TH")}
                      </span>
                      <button type="button" disabled={!!busy || !docs.length} onClick={() => run(o.personId, () => onImportFiles(docs))} className={btn + " shrink-0 px-2 py-0.5 text-xs"}>{busy === o.personId ? "…" : "ดึง + อ่านใหม่"}</button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const btn = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";
const btnPrimary = "rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50";
