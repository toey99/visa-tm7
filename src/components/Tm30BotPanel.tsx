"use client";

// =============================================================
// TM.30 bot panel — queue a batch for the "TM30 Bot" Chrome extension
// =============================================================
// Works from any device: the phone at the counter queues the batch and
// confirms it; the extension in Chrome on the home PC (signed in to the
// TM.30 site by the user) does the uploading and brings the receipts back.
// Nothing is saved on the TM.30 site until "ยืนยันบันทึก" is pressed here.
import { useCallback, useEffect, useRef, useState } from "react";
import { buildTm30Excel, plusDaysDdmmyyyy } from "@/lib/today/clientTools";
import type { Person } from "@/lib/today/types";

type JobStatus = "queued" | "working" | "review" | "confirmed" | "saving" | "downloading" | "done" | "error" | "cancelled";
type Job = {
  id: string; createdAt: string; ns: string; day: string; office: string; label: string;
  people: { id: string; passportNo: string; name: string }[];
  status: JobStatus; message?: string; preview?: string[]; done?: string[];
};
export type Tm30Group = { tag: string; people: Person[] };

const ACTIVE: JobStatus[] = ["queued", "working", "review", "confirmed", "saving", "downloading"];
const clean = (s: string) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export default function Tm30BotPanel({ ns, date, office, officeLabel, getGroups, disabled, onFiled, onError }: {
  ns: "days" | "run";
  date: string;                       // DD/MM/YYYY
  office: string;
  officeLabel: string;
  getGroups: () => Tm30Group[];       // the batches the output buttons are currently set to
  disabled?: boolean;
  onFiled: () => void;                // receipts landed on the board → pull them in
  onError: (msg: string) => void;
}) {
  const day = date.replace(/\//g, "");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [botSeenAt, setBotSeenAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const filed = useRef(-1);
  const onFiledRef = useRef(onFiled);
  useEffect(() => { onFiledRef.current = onFiled; }, [onFiled]);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/tm30", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { jobs?: Job[]; botSeenAt?: string | null };
      const mine = (j.jobs ?? []).filter((x) => x.ns === ns && x.day === day && x.office === office).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
      setJobs(mine);
      setBotSeenAt(j.botSeenAt ?? null);
      const n = mine.reduce((s, x) => s + (x.done?.length ?? 0), 0);
      if (filed.current >= 0 && n > filed.current) onFiledRef.current();
      filed.current = n;
    } catch { /* offline for a moment — the next tick tries again */ }
  }, [ns, day, office]);

  // first look when the board opens or changes; then only while a job is running
  useEffect(() => { filed.current = -1; setJobs([]); void load(); }, [load]);
  const anyActive = jobs.some((j) => ACTIVE.includes(j.status));
  useEffect(() => {
    if (!anyActive) return;
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 4000);
    const onVis = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [anyActive, load]);

  async function send() {
    const groups = getGroups();
    if (!groups.length) { onError("ยังไม่มีคนที่มีชื่อและเลขพาสปอร์ตให้ส่งเข้า TM30"); return; }
    const n = groups.reduce((s, g) => s + g.people.length, 0);
    if (!window.confirm(`ส่ง ${n} คน${groups.length > 1 ? ` (${groups.length} ชุด)` : ""} ให้บอทอัปเข้าเว็บ TM30?\n\nบอทจะอัป Excel แล้วหยุดรอ — ต้องกด "ยืนยันบันทึก" ที่นี่อีกครั้งก่อนจะแจ้งจริง`)) return;
    setBusy(true);
    try {
      for (const g of groups) {
        const xls = await buildTm30Excel(g.people, plusDaysDdmmyyyy(10));
        const fd = new FormData();
        fd.set("meta", JSON.stringify({
          ns, day, office,
          label: `${officeLabel} ${date}${g.tag.replace(/_/g, " ")} · ${g.people.length} คน`,
          people: g.people.map((p) => ({ id: p.id, passportNo: p.fields.passportNo, name: [p.fields.lastName, p.fields.firstName].filter(Boolean).join(" ") })),
        }));
        fd.set("file", new File([xls], "tm30.xls", { type: "application/vnd.ms-excel" }));
        const r = await fetch("/api/tm30", { method: "POST", body: fd });
        if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || `ส่งงานไม่สำเร็จ (${r.status})`);
      }
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(id: string, status: "confirmed" | "cancelled") {
    setBusy(true);
    try {
      const r = await fetch("/api/tm30", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, who: "board", status }) });
      if (!r.ok && r.status !== 409) throw new Error(`อัปเดตงานไม่สำเร็จ (${r.status})`);
      await load();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const botOnline = !!botSeenAt && Date.now() - new Date(botSeenAt).getTime() < 7 * 60 * 1000;

  return (
    <div className="rounded-2xl border border-pink-200 bg-pink-50/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={send} disabled={disabled || busy} className="rounded-lg bg-pink-400 px-3 py-1.5 text-sm font-semibold text-white hover:bg-pink-500 disabled:cursor-not-allowed disabled:opacity-50">
          🤖 ส่งเข้า TM30 (บอท)
        </button>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${botOnline ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
          {botOnline ? "● บอทที่บ้านออนไลน์" : "○ ยังไม่เห็นบอท"}
        </span>
        <span className="text-xs text-pink-900/70">ใช้ชุด/คนที่เลือกเหมือนปุ่ม Excel TM30 · บอทจะรอให้กดยืนยันก่อนแจ้งจริง</span>
      </div>

      {jobs.map((j) => {
        const want = j.people.map((p) => clean(p.passportNo));
        const got = (j.preview ?? []).map(clean);
        const missing = j.people.filter((p) => !got.includes(clean(p.passportNo)));
        const extra = got.filter((p) => !want.includes(p));
        const doneN = j.done?.length ?? 0;
        return (
          <div key={j.id} className="mt-2 rounded-xl border border-pink-200 bg-white p-2.5 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-slate-800">{j.label}</span>
              <span className="text-xs text-slate-500">{new Date(j.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</span>
            </div>

            {j.status === "queued" && (
              <p className="mt-1 text-amber-700">⏳ รอบอทรับงาน…{!botOnline && " — เปิด Chrome ที่บ้านค้างหน้าเว็บ TM30 (login แล้ว) และเปิดสวิตช์ “รับงานจาก toyka” ในกล่องบอท"}</p>
            )}
            {j.status === "working" && <p className="mt-1 text-sky-700">🤖 บอทกำลังอัป Excel เข้าเว็บ TM30…</p>}
            {j.status === "review" && (
              <div className="mt-1 rounded-lg bg-amber-50 p-2">
                <p className="font-semibold text-amber-900">เว็บ TM30 อ่านได้ {got.length} คน จากที่ส่ง {want.length} คน {!missing.length && !extra.length ? "✓ ตรงกันทุกคน" : "⚠️ ไม่ตรง"}</p>
                {missing.length > 0 && <p className="text-rose-700">ไม่อยู่ในที่เว็บอ่านได้: {missing.map((p) => `${p.name} ${p.passportNo}`).join(", ")}</p>}
                {extra.length > 0 && <p className="text-rose-700">เว็บอ่านได้แต่ไม่อยู่ในชุดนี้: {extra.join(", ")}</p>}
                <ol className="mt-1 list-decimal pl-5 text-xs text-slate-700">
                  {j.people.map((p) => <li key={p.id}>{p.name} · {p.passportNo}</li>)}
                </ol>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setStatus(j.id, "confirmed")} disabled={busy} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50">✅ ยืนยันบันทึกเข้า TM30</button>
                  <button type="button" onClick={() => setStatus(j.id, "cancelled")} disabled={busy} className="rounded-lg bg-rose-100 px-3 py-1.5 text-sm font-semibold text-rose-700 hover:bg-rose-200 disabled:opacity-50">ยกเลิก</button>
                </div>
              </div>
            )}
            {(j.status === "confirmed" || j.status === "saving") && <p className="mt-1 text-sky-700">💾 บอทกำลังบันทึกบนเว็บ TM30…</p>}
            {j.status === "downloading" && <p className="mt-1 text-sky-700">📄 กำลังเอาใบรับแจ้งขึ้นบอร์ด {doneN}/{j.people.length}{j.message ? ` · ${j.message}` : ""}</p>}
            {j.status === "done" && <p className="mt-1 text-emerald-700">✅ เสร็จ — ใบรับแจ้งขึ้นบอร์ด {doneN}/{j.people.length} คน{j.message ? ` · ${j.message}` : ""}</p>}
            {j.status === "error" && <p className="mt-1 text-rose-700">⚠️ บอทหยุด: {j.message || "ไม่ทราบสาเหตุ"} (ขึ้นบอร์ดแล้ว {doneN}/{j.people.length})</p>}
            {j.status === "cancelled" && <p className="mt-1 text-slate-500">ยกเลิกแล้ว{j.message ? ` · ${j.message}` : ""}</p>}

            {(j.status === "queued" || j.status === "working" || j.status === "error") && (
              <button type="button" onClick={() => setStatus(j.id, "cancelled")} disabled={busy} className="mt-1 text-xs font-semibold text-rose-600 underline disabled:opacity-50">ยกเลิกงานนี้</button>
            )}
          </div>
        );
      })}
    </div>
  );
}
