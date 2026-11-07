"use server";

import { GoogleGenAI, Type } from "@google/genai";
import {
  classifyGeminiError,
  friendlyGeminiMessage,
  isTransientGeminiError,
} from "@/lib/geminiError";

export type AiTm30ScanResult = {
  houseNo: string;
  road: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
};

export type Tm30ScanResponse =
  | { ok: true; data: AiTm30ScanResult }
  | { ok: false; error: string };

// Keep in sync with serverActions.bodySizeLimit (4.5MB in next.config.ts), the
// ~4.5MB Vercel request-body ceiling, and the client-side guard in
// AiTm30Scanner.tsx. Larger scans are compressed client-side before upload.
const MAX_BYTES = 4 * 1024 * 1024;
const PDF_MIME = "application/pdf";
const MODEL = "gemini-2.5-flash";

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

const PROMPT = `Analyze this Thai TM.30 Receipt of Notification PDF. Extract the resident's address in Thailand. Return EXCLUSIVELY a JSON object with these fields: { houseNo, road, subDistrict, district, province, postalCode }.

Strict rules:
- The document may be in Thai. Translate or transliterate every value to English.
- All text values must be UPPERCASE English, except postalCode which must be digits only.
- "houseNo" is the building/house number only.
- "road" is the street/road name (ถนน) without the word "ROAD".
- Do NOT extract or include soi (ซอย), moo (หมู่), alley, or lane information in any field.
- "subDistrict" is the tambon/khwaeng (ตำบล/แขวง).
- "district" is the amphoe/khet (อำเภอ/เขต).
- "province" is the changwat (จังหวัด).
- "postalCode" is the 5-digit Thai postal code (รหัสไปรษณีย์), digits only — e.g. "10110".
- If a field is unreadable or missing, return an empty string "" for it. Do NOT guess.
- Return only the JSON object — no prose, no markdown fences.`;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    const details: Record<string, unknown> = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
    const apiErr = err as Error & {
      status?: number;
      statusCode?: number;
      cause?: unknown;
      error?: unknown;
    };
    if (apiErr.status !== undefined) details.status = apiErr.status;
    if (apiErr.statusCode !== undefined) details.statusCode = apiErr.statusCode;
    if (apiErr.cause !== undefined) details.cause = apiErr.cause;
    if (apiErr.error !== undefined) details.error = apiErr.error;
    return details;
  }
  return { value: err };
}

function logScanEvent(phase: string, details?: Record<string, unknown>) {
  if (details) {
    console.log(`[scanTm30] ${phase}`, details);
  } else {
    console.log(`[scanTm30] ${phase}`);
  }
}

function logScanError(phase: string, err: unknown, details?: Record<string, unknown>) {
  console.error(`[scanTm30] ${phase}`, {
    ...details,
    error: formatError(err),
  });
}

function hasPdfMagicBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  );
}

function isPdfUpload(file: File, bytes: Uint8Array): boolean {
  if (file.type === PDF_MIME) return true;
  if (file.name.toLowerCase().endsWith(".pdf")) return true;
  return hasPdfMagicBytes(bytes);
}

export async function scanTm30(formData: FormData): Promise<Tm30ScanResponse> {
  logScanEvent("request received");

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logScanError("missing API key", new Error("GEMINI_API_KEY is not set"));
    return {
      ok: false,
      error: "Server is missing GEMINI_API_KEY. Add it to .env.local and restart the dev server.",
    };
  }

  const file = formData.get("document");
  if (!(file instanceof File)) {
    logScanError("invalid upload", new Error("FormData field 'document' is missing or not a File"));
    return { ok: false, error: "No PDF was provided." };
  }

  logScanEvent("upload metadata", {
    fileName: file.name,
    mimeType: file.type || "(empty)",
    sizeBytes: file.size,
  });

  if (file.size > MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    return { ok: false, error: `PDF is ${mb} MB; please upload under 4 MB.` };
  }

  const bytes = await file.arrayBuffer();
  const byteView = new Uint8Array(bytes);

  if (!isPdfUpload(file, byteView)) {
    logScanError("unsupported file type", new Error("Upload is not recognized as PDF"), {
      fileName: file.name,
      mimeType: file.type || "(empty)",
    });
    return { ok: false, error: "File must be a PDF document." };
  }
  if (!hasPdfMagicBytes(byteView)) {
    logScanError("invalid PDF header", new Error("Missing %PDF magic bytes"), {
      fileName: file.name,
      firstBytes: Array.from(byteView.slice(0, 8)),
    });
    return { ok: false, error: "The uploaded file does not appear to be a valid PDF." };
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    // Send the PDF inline (base64), exactly like the passport scanner. This
    // avoids the Files API upload + up-to-30s ACTIVE polling round-trip, whose
    // latency was blowing past the serverless function timeout (surfacing as a
    // thrown Server Action / "couldn't upload" error, especially on mobile).
    const base64 = Buffer.from(bytes).toString("base64");

    const request = {
      model: MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: PDF_MIME, data: base64 } },
            { text: PROMPT },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            houseNo: { type: Type.STRING },
            road: { type: Type.STRING },
            subDistrict: { type: Type.STRING },
            district: { type: Type.STRING },
            province: { type: Type.STRING },
            postalCode: { type: Type.STRING },
          },
          required: [
            "houseNo",
            "road",
            "subDistrict",
            "district",
            "province",
            "postalCode",
          ],
          propertyOrdering: [
            "houseNo",
            "road",
            "subDistrict",
            "district",
            "province",
            "postalCode",
          ],
        },
      },
    };

    logScanEvent("calling Gemini generateContent (inline PDF)", {
      model: MODEL,
      base64Length: base64.length,
    });

    let text: string | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        logScanEvent("generateContent attempt", { attempt, maxAttempts: MAX_ATTEMPTS });
        const response = await ai.models.generateContent(request);
        text = response.text;
        logScanEvent("generateContent success", {
          attempt,
          responseLength: text?.length ?? 0,
          responsePreview: text?.slice(0, 200),
        });
        break;
      } catch (err) {
        logScanError("generateContent attempt failed", err, { attempt });
        if (isTransientGeminiError(err) && attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw err;
      }
    }

    if (!text) {
      return {
        ok: false,
        error: "The AI returned an empty response. Try a clearer TM.30 PDF.",
      };
    }

    let parsed: AiTm30ScanResult;
    try {
      parsed = JSON.parse(text) as AiTm30ScanResult;
      logScanEvent("parsed address JSON", parsed);
    } catch (parseErr) {
      logScanError("JSON parse failed", parseErr, { rawText: text });
      return {
        ok: false,
        error: "The AI returned an invalid response. Please try uploading the TM.30 PDF again.",
      };
    }

    return { ok: true, data: parsed };
  } catch (err) {
    logScanError("scan failed", err, {
      fileName: file.name,
      sizeBytes: file.size,
      model: MODEL,
      kind: classifyGeminiError(err),
    });

    return { ok: false, error: friendlyGeminiMessage(err, "TM.30 PDF") };
  }
}
