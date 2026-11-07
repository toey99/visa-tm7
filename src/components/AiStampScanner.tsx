"use client";

// Scan a photo of the passport's Thai entry-stamp page: arrival date, port,
// transport, and the blue "admitted until" date. Uses the same analyzeDoc
// action as the /today board.

import { useRef, useState } from "react";
import { analyzeDoc, type AnalyzedDoc } from "@/app/actions/analyzeDoc";
import { downscaleImage } from "@/lib/today/clientTools";

export type StampScanResult = Pick<AnalyzedDoc, "arrivalDate" | "admittedUntil" | "portOfArrival" | "arrivedBy" | "visaType">;

export default function AiStampScanner({ onScan, onError }: { onScan: (d: StampScanResult) => void; onError: (m: string) => void }) {
  const [scanning, setScanning] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setScanning(true);
    try {
      const blob = await downscaleImage(file, 1800);
      const fd = new FormData();
      fd.append("image", new File([blob], "stamp.jpg", { type: "image/jpeg" }));
      const r = await analyzeDoc(fd);
      if (!r.ok) { onError(r.error); return; }
      if (r.data.docType !== "stamp" && !r.data.arrivalDate) {
        onError("ภาพนี้ไม่น่าใช่หน้าตราเข้าเมือง (อ่านวันเข้าเมืองไม่เจอ) ลองถ่ายใหม่ให้เห็นตราสีแดงชัด ๆ");
        return;
      }
      onScan(r.data);
    } catch {
      onError("อัปโหลดรูปตราไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setScanning(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        disabled={scanning}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {scanning ? "Reading stamp…" : "Scan Entry Stamp"}
      </button>
      <span className="text-xs text-slate-600">Photo of the page with the red Thai arrival stamp — fills arrival date, port, transport, admitted-until.</span>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
    </div>
  );
}
