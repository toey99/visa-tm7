"use client";

// =============================================================
// 90-day board → TM.30 for the people on the officer's list
// =============================================================
// The officer sends back a (usually handwritten) list of passport numbers
// that need a TM.30. Photograph / pick that list (or type the numbers): they
// are matched to the passports already on this board, the TM.30 upload sheet
// is built from those passport pages, and the batch goes to the TM30 Bot —
// same review-then-confirm as the day board. The receipts come back as ONE
// merged PDF to pass on to the officer in LINE.
import { useMemo, useRef, useState } from "react";
import Tm30BotPanel, { type Tm30Group } from "@/components/Tm30BotPanel";
import { downscaleImage } from "@/lib/today/clientTools";
import { EMPTY_FIELDS, todayDdmmyyyy, type Person, type PersonFields } from "@/lib/today/types";
import { ppKey, type D90Case } from "@/lib/d90/types";

type Row = { n: string; c?: D90Case; how: "exact" | "fuzzy" | "none" };

// handwriting look-alikes: compare with these folded together
const canon = (s: string) => s.replace(/[OQD]/g, "0").replace(/[IL]/g, "1").replace(/Z/g, "2").replace(/S/g, "5").replace(/B/g, "8").replace(/G/g, "6");
function near1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export default function D90Tm30Panel({ cases, onError }: { cases: D90Case[]; onError: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());     // rows unticked by hand
  const [reading, setReading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  // newest passport first, so a number seen twice resolves to the latest job
  const pool = useMemo(() => [...cases].filter((c) => ppKey(c.passport.passportNo)).sort((a, b) => b.passport.ts - a.passport.ts), [cases]);

  function match(src: string) {
    const nums = Array.from(new Set(src.toUpperCase().split(/[\s,;，、]+/).map(ppKey).filter((n) => n.length >= 6 && /\d/.test(n))));
    const out: Row[] = nums.map((n) => {
      const exact = pool.find((c) => ppKey(c.passport.passportNo) === n);
      if (exact) return { n, c: exact, how: "exact" };
      const alike = pool.filter((c) => canon(ppKey(c.passport.passportNo)) === canon(n));
      if (alike.length) return { n, c: alike[0], how: "fuzzy" };
      const close = pool.filter((c) => near1(canon(ppKey(c.passport.passportNo)), canon(n)));
      const distinct = new Set(close.map((c) => ppKey(c.passport.passportNo)));
      if (distinct.size === 1) return { n, c: close[0], how: "fuzzy" };
      return { n, how: "none" };
    });
    setRows(out);
    setOff(new Set());
  }

  async function readPicture(f: File) {
    setReading(true);
    try {
      const small = await downscaleImage(f, 1800, 0.9);
      const fd = new FormData();
      fd.set("image", new File([small], "list.jpg", { type: "image/jpeg" }));
      const r = await fetch("/api/d90/tm30", { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as { numbers?: string[]; error?: string };
      if (!r.ok) throw new Error(j.error || `อ่านรูปไม่สำเร็จ (${r.status})`);
      if (!j.numbers?.length) throw new Error("อ่านเลขพาสปอร์ตจากรูปไม่ได้ — พิมพ์เลขลงในช่องแทนได้");
      const joined = j.numbers.join("\n");
      setText(joined);
      match(joined);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  }

  const chosen = (rows ?? []).filter((r) => r.c && !off.has(r.n));

  // The board keeps only name + number; the TM.30 sheet also needs sex and
  // birth date, so each chosen passport page is read once more (3 at a time).
  async function getGroups(): Promise<Tm30Group[]> {
    if (!chosen.length) return [];
    const people: Person[] = new Array(chosen.length);
    const failed: string[] = [];
    let next = 0;
    async function worker() {
      for (;;) {
        const k = next++;
        if (k >= chosen.length) return;
        const it = chosen[k].c!.passport;
        try {
          const r = await fetch(`/api/d90/tm30?img=${encodeURIComponent(it.img)}`, { cache: "no-store" });
          const j = (await r.json().catch(() => ({}))) as Partial<Pick<PersonFields, "title" | "firstName" | "lastName" | "nationality" | "dateOfBirth" | "passportNo">> & { error?: string };
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          const [fallbackLast, ...fallbackGiven] = it.name.trim().split(/\s+/);
          const fields: PersonFields = {
            ...EMPTY_FIELDS,
            title: (j.title || "") as PersonFields["title"],
            firstName: j.firstName || fallbackGiven.join(" "),
            lastName: j.lastName || fallbackLast || "",
            chineseName: it.cn ?? "",
            nationality: j.nationality || it.nationality || "CHINESE",
            dateOfBirth: j.dateOfBirth || "",
            passportNo: ppKey(it.passportNo),          // the board's number is the checked one
          };
          if (!fields.title) throw new Error("อ่านเพศจากหน้าพาสปอร์ตไม่ได้");
          if (!fields.firstName) throw new Error("อ่านชื่อจากหน้าพาสปอร์ตไม่ได้");
          people[k] = { id: it.id, order: k + 1, fields, files: [], createdAt: it.ts };
        } catch (e) {
          failed.push(`${it.name || it.passportNo}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    if (failed.length) throw new Error(`อ่านหน้าพาสปอร์ตไม่ครบ — ${failed.join(" · ")}`);
    return [{ tag: "", people }];
  }

  return (
    <div className="mt-3 rounded-2xl border border-violet-200 bg-violet-50/70 p-3">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center justify-between text-left text-sm font-semibold text-violet-900">
        <span>📄 TM30 ตามรายการเจ้าหน้าที่</span>
        <span className="text-xs font-normal text-violet-700">{open ? "ซ่อน ▲" : "เปิด ▼"}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void readPicture(f); }} />
            <button type="button" disabled={reading} onClick={() => fileRef.current?.click()} className="rounded-lg bg-violet-400 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-500 disabled:opacity-50">{reading ? "กำลังอ่านรูป…" : "📷 เลือกรูปรายการเลขพาสปอร์ต"}</button>
            <span className="text-xs text-violet-800">หรือพิมพ์/วางเลขพาสปอร์ตเอง (บรรทัดละเลข)</span>
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={"EQ6134081\nEK3966358"} className="w-full rounded-xl border border-violet-200 bg-white px-3 py-2 font-mono text-sm" />
          <button type="button" onClick={() => match(text)} disabled={!text.trim()} className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-violet-800 ring-1 ring-violet-300 disabled:opacity-50">🔎 จับคู่กับบอร์ด</button>

          {rows && (
            <div className="rounded-xl border border-violet-200 bg-white p-2 text-sm">
              <p className="font-semibold text-slate-800">เจอ {rows.filter((r) => r.c).length} จาก {rows.length} เลข · เลือกไว้ {chosen.length} คน</p>
              <ul className="mt-1 space-y-1">
                {rows.map((r) => (
                  <li key={r.n} className="flex flex-wrap items-center gap-2">
                    {r.c ? (
                      <input type="checkbox" checked={!off.has(r.n)} onChange={() => setOff((prev) => { const n = new Set(prev); if (n.has(r.n)) n.delete(r.n); else n.add(r.n); return n; })} />
                    ) : <span className="w-[13px]" />}
                    <span className="font-mono">{r.n}</span>
                    {r.how === "exact" && <span className="text-emerald-700">✓ {[r.c!.passport.name, r.c!.passport.cn].filter(Boolean).join(" ")}</span>}
                    {r.how === "fuzzy" && <span className="text-amber-700">≈ {[r.c!.passport.name, r.c!.passport.cn].filter(Boolean).join(" ")} · ในบอร์ดคือ <b className="font-mono">{r.c!.passport.passportNo}</b> — ตรวจว่าใช่คนนี้</span>}
                    {r.how === "none" && <span className="text-rose-700">✗ ไม่เจอในบอร์ด — เช็คเลข หรือ forward หน้าพาสปอร์ตเข้ากลุ่มกล่องรับงานก่อน</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Tm30BotPanel
            ns="d90"
            date={todayDdmmyyyy()}
            office="D90"
            officeLabel="90 วัน"
            getGroups={getGroups}
            disabled={!chosen.length}
            onFiled={() => {}}
            onError={onError}
            hint="ส่งเฉพาะคนที่ติ๊กไว้ด้านบน · บอทจะรอให้กดยืนยันก่อนแจ้งจริง · เสร็จแล้วได้ PDF รวมไฟล์เดียว"
            mergedPdf
          />
        </div>
      )}
    </div>
  );
}
