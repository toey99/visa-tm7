"use client";

import { useRef, useState } from "react";
import { scanPassport, type AiScanResult } from "@/app/actions/scanPassport";

export type { AiScanResult };

// Cap the longest edge so a 50/200 MP phone photo (Samsung S24 Ultra etc.)
// is re-encoded to a modest JPEG the server will accept. This also normalizes
// odd source formats/empty MIME types coming from mobile gallery pickers to a
// plain image/jpeg. Gemini reads the bio page fine at this resolution.
const MAX_EDGE = 2000;
const JPEG_QUALITY = 0.85;

async function downscaleToJpeg(file: File): Promise<File> {
  // Decode via createImageBitmap (handles EXIF orientation on modern browsers);
  // fall back to an <img> element if the browser can't decode this source.
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("decode failed"));
        el.src = url;
      });
      bitmap = await createImageBitmap(img);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const { width, height } = bitmap;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  if (!blob) throw new Error("toBlob failed");

  const name = file.name.replace(/\.[^.]+$/, "") || "passport";
  return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
}

export default function AiPassportScanner({
  onScan,
  onError,
}: {
  onScan: (data: AiScanResult) => void;
  onError: (msg: string) => void;
}) {
  const [scanning, setScanning] = useState(false);
  const [stage, setStage] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setScanning(true);
    setStage("Preparing image...");

    try {
      // Re-encode client-side so large/odd mobile photos become a clean,
      // small JPEG. If anything goes wrong, fall back to the original file.
      let upload = file;
      try {
        upload = await downscaleToJpeg(file);
      } catch {
        upload = file;
      }

      const fd = new FormData();
      fd.append("image", upload);

      setStage("Analyzing with AI...");
      const result = await scanPassport(fd);

      if (result.ok) {
        onScan(result.data);
      } else {
        onError(result.error);
      }
    } catch {
      // Network failure or an unexpected server-action crash — keep the
      // alert user-friendly instead of leaking a raw error/JSON string.
      onError("The AI service is currently busy. Please try again in a moment.");
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
        accept="image/jpeg,image/png,image/webp"
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
        className="inline-flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-violet-300"
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
              d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z"
            />
          </svg>
        )}
        {scanning ? stage : "Scan with AI"}
      </button>
      {!scanning && (
        <p className="text-xs text-slate-500">
          Photo of the passport bio page — Gemini extracts the fields directly.
        </p>
      )}
    </div>
  );
}
