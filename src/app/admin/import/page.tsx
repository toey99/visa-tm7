"use client";

// /admin/import — copy the old site's data into the new store, page by page, with a running count.
// Only useful on the new deployment (see docs/NEW-SYSTEM.md). Repeatable at any time.
import { useRef, useState } from "react";

export default function ImportPage() {
  const [prefix, setPrefix] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [tot, setTot] = useState({ copied: 0, skipped: 0, failed: 0 });
  const stop = useRef(false);

  async function run() {
    setRunning(true); stop.current = false; setLog([]);
    let cursor: string | null = null;
    const t = { copied: 0, skipped: 0, failed: 0 };
    try {
      do {
        const r: Response = await fetch("/api/admin/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prefix, cursor }) });
        const j = (await r.json()) as { copied?: number; skipped?: number; failed?: string[]; failedCount?: number; cursor?: string | null; error?: string };
        if (!r.ok) { setLog((l) => [...l, `หยุด: ${j.error ?? r.status}`]); break; }
        t.copied += j.copied ?? 0; t.skipped += j.skipped ?? 0; t.failed += j.failedCount ?? 0;
        setTot({ ...t });
        if (j.failed?.length) setLog((l) => [...l, ...j.failed!]);
        cursor = j.cursor ?? null;
      } while (cursor && !stop.current);
      setLog((l) => [...l, stop.current ? "หยุดตามที่สั่ง — กดเริ่มใหม่ได้ ของที่ก๊อปแล้วจะถูกข้าม" : "จบรอบนี้แล้ว"]);
    } catch (e) { setLog((l) => [...l, `หยุด: ${e instanceof Error ? e.message : String(e)}`]); }
    setRunning(false);
  }

  return (
    <main className="mx-auto max-w-2xl p-5">
      <h1 className="text-xl font-extrabold text-slate-900">นำเข้าข้อมูลจากเว็บตัวเก่า</h1>
      <p className="mt-1 text-sm text-slate-500">ก๊อปข้อมูลและไฟล์จากตัวเก่ามาตัวใหม่ ทำซ้ำได้ทุกเมื่อ ไม่แก้และไม่ลบอะไรในตัวเก่า</p>
      <label className="mt-4 block text-xs font-bold text-slate-500">เฉพาะโฟลเดอร์ (เว้นว่าง = ทั้งหมด) เช่น ledger/ , days/28112026/
        <input id="import-prefix" className="mt-1 w-full rounded-xl border-2 border-sky-100 bg-white px-3 py-2 text-sm font-semibold" value={prefix} onChange={(e) => setPrefix(e.target.value.trim())} disabled={running} />
      </label>
      <div className="mt-3 flex gap-2">
        <button type="button" className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50" onClick={() => void run()} disabled={running}>{running ? "กำลังก๊อป…" : "เริ่มก๊อป"}</button>
        {running && <button type="button" className="rounded-xl border-2 border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600" onClick={() => { stop.current = true; }}>หยุด</button>}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs font-bold">
        <div className="rounded-xl bg-emerald-100 py-2 text-emerald-800"><b className="block text-2xl tabular-nums">{tot.copied}</b>ก๊อปแล้ว</div>
        <div className="rounded-xl bg-slate-100 py-2 text-slate-600"><b className="block text-2xl tabular-nums">{tot.skipped}</b>มีอยู่แล้ว ข้าม</div>
        <div className="rounded-xl bg-pink-100 py-2 text-pink-700"><b className="block text-2xl tabular-nums">{tot.failed}</b>ไม่สำเร็จ</div>
      </div>
      {log.length > 0 && <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 text-xs text-slate-600">{log.join("\n")}</pre>}
    </main>
  );
}
