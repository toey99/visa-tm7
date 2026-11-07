"use client";

import { useRef, useState } from "react";
import { scanTm30, type AiTm30ScanResult } from "@/app/actions/scanTm30";
import { compressPdf } from "@/lib/compressPdf";

export type { AiTm30ScanResult };

// Keep in sync with serverActions.bodySizeLimit (4.5MB) in next.config.ts and the
// ~4.5MB Vercel serverless request-body ceiling. We guard a bit under the limit
// to leave room for multipart/form-data overhead.
const MAX_PDF_BYTES = 4 * 1024 * 1024;

export default function AiTm30Scanner({
  onScan,
  onError,
}: {
  onScan: (data: AiTm30ScanResult, file: File) => void;
  onError: (msg: string) => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [stage, setStage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setScanning(true);
    setStage("Reading PDF...");

    try {
      // Oversized PDFs (usually a full-page scan) would be rejected by the
      // Server Action's body-size limit before it ever runs. Rasterize + JPEG
      // re-compress client-side to squeeze them under the limit first.
      let upload = file;
      if (file.size > MAX_PDF_BYTES) {
        setStage("Compressing large PDF...");
        try {
          upload = await compressPdf(file);
        } catch {
          upload = file; // fall through to the guard below
        }

        if (upload.size > MAX_PDF_BYTES) {
          const mb = (upload.size / 1024 / 1024).toFixed(1);
          onError(
            `This PDF is still ${mb} MB after compression (max 4 MB). Please upload a smaller TM.30 PDF, or fill the address in manually.`,
          );
          return;
        }
      }

      setStage("Extracting address from TM.30...");
      const fd = new FormData();
      fd.append("document", upload);

      const result = await scanTm30(fd);

      if (result.ok) {
        // Attach the (possibly compressed) file that actually uploaded — the
        // original may be too large for the packet-generation upload too.
        onScan(result.data, upload);
      } else {
        onError(result.error);
      }
    } catch {
      // The Server Action itself threw (network drop, or the body-size limit was
      // exceeded) — keep the message honest rather than blaming the AI service.
      onError(
        "Couldn't upload the TM.30 PDF. Check your connection and try again, or fill the address in manually.",
      );
    } finally {
      setScanning(false);
      setStage("");
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={scanning}
        className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-teal-300"
      >
        {scanning ? (
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ) : (
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v12a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z"
            />
          </svg>
        )}
        {scanning ? stage || "Scanning..." : "Scan TM.30 with AI"}
      </button>
      {!scanning && (
        <p className="text-xs text-slate-500">
          PDF of your TM.30 receipt — extracts your Thailand address in English.
        </p>
      )}
    </div>
  );
}
