"use server";

import { GoogleGenAI, Type } from "@google/genai";
import { friendlyGeminiMessage, isTransientGeminiError } from "@/lib/geminiError";

export type AiScanResult = {
  title: "MR." | "MRS." | "MISS";
  firstName: string;
  lastName: string;
  nationality: string;          // demonym, e.g. CHINESE
  dateOfBirth: string;          // DD/MM/YYYY
  placeOfBirth: string;
  passportNo: string;
  passportIssueDate: string;    // DD/MM/YYYY
  passportExpiryDate: string;   // DD/MM/YYYY
  passportIssuedAt: string;
};

export type ScanResponse =
  | { ok: true; data: AiScanResult }
  | { ok: false; error: string };

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"];

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function logScanEvent(phase: string, details?: Record<string, unknown>) {
  if (details) {
    console.log(`[scanPassport] ${phase}`, details);
  } else {
    console.log(`[scanPassport] ${phase}`);
  }
}

// Sniff the image type from the first bytes so an empty or unexpected MIME
// (common from mobile gallery pickers, e.g. Samsung) doesn't hard-fail before
// Gemini ever sees the photo. Returns a canonical MIME or null if unrecognized.
function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  ) {
    return "image/webp";
  }
  return null;
}

const PROMPT = `You are reading the bio-data page of an international passport.
Extract the applicant's details and return them as JSON matching the provided schema.

Strict rules:
- All text values must be UPPERCASE English.
- "nationality" must be the English DEMONYM (e.g. CHINESE, BRITISH, AMERICAN, THAI). Never an ISO code or country name.
- "title": "MR." for male, "MRS." for married female, "MISS" for unmarried female. If sex is M, return "MR."; if F and you can't tell married vs. unmarried, return "MRS.".
- All dates must be formatted as DD/MM/YYYY (two-digit day, two-digit month, four-digit year).
- "passportNo" is the document number printed on the bio page (often top-right), not the personal number from the MRZ.
- If a field is unreadable or missing from the image, return an empty string "" for it. Do NOT guess.
- Return only the JSON object — no prose, no markdown fences.`;

export async function scanPassport(formData: FormData): Promise<ScanResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "Server is missing GEMINI_API_KEY. Add it to .env.local and restart the dev server.",
    };
  }

  const file = formData.get("image");
  if (!(file instanceof File)) {
    logScanEvent("invalid upload", { reason: "field 'image' missing or not a File" });
    return { ok: false, error: "No image was provided." };
  }

  logScanEvent("upload metadata", {
    fileName: file.name,
    mimeType: file.type || "(empty)",
    sizeBytes: file.size,
  });

  if (file.size > MAX_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1);
    logScanEvent("rejected: too large", { sizeBytes: file.size });
    return { ok: false, error: `Image is ${mb} MB; please upload under 8 MB.` };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const bytes = await file.arrayBuffer();
    const byteView = new Uint8Array(bytes);

    // Trust the declared MIME when it's one we allow; otherwise sniff the bytes
    // so an empty/odd MIME from a mobile picker still goes through.
    const sniffed = sniffImageMime(byteView);
    const mimeType = ALLOWED_TYPES.includes(file.type) ? file.type : sniffed;
    if (!mimeType) {
      logScanEvent("rejected: unrecognized image", {
        declaredMime: file.type || "(empty)",
        firstBytes: Array.from(byteView.slice(0, 8)),
      });
      return { ok: false, error: "File must be a JPEG, PNG, or WebP image." };
    }
    logScanEvent("resolved image type", {
      declaredMime: file.type || "(empty)",
      sniffedMime: sniffed ?? "(none)",
      usingMime: mimeType,
    });

    const base64 = Buffer.from(bytes).toString("base64");

    const request = {
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType, data: base64 } },
            { text: PROMPT },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            title: { type: Type.STRING, enum: ["MR.", "MRS.", "MISS"] },
            firstName: { type: Type.STRING },
            lastName: { type: Type.STRING },
            nationality: { type: Type.STRING },
            dateOfBirth: { type: Type.STRING },
            placeOfBirth: { type: Type.STRING },
            passportNo: { type: Type.STRING },
            passportIssueDate: { type: Type.STRING },
            passportExpiryDate: { type: Type.STRING },
            passportIssuedAt: { type: Type.STRING },
          },
          required: [
            "title",
            "firstName",
            "lastName",
            "nationality",
            "dateOfBirth",
            "placeOfBirth",
            "passportNo",
            "passportIssueDate",
            "passportExpiryDate",
            "passportIssuedAt",
          ],
          propertyOrdering: [
            "title",
            "firstName",
            "lastName",
            "nationality",
            "dateOfBirth",
            "placeOfBirth",
            "passportNo",
            "passportIssueDate",
            "passportExpiryDate",
            "passportIssuedAt",
          ],
        },
      },
    };

    // Retry transient errors (503 overload, 429 rate-limit, 500 server)
    // with a short delay between tries; fail fast on permanent ones.
    let text: string | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        logScanEvent("generateContent attempt", { attempt, maxAttempts: MAX_ATTEMPTS });
        const response = await ai.models.generateContent(request);
        text = response.text;
        logScanEvent("generateContent success", {
          attempt,
          responseLength: text?.length ?? 0,
        });
        break;
      } catch (err) {
        logScanEvent("generateContent attempt failed", { attempt });
        if (isTransientGeminiError(err) && attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw err;
      }
    }

    if (!text) {
      logScanEvent("empty response");
      return {
        ok: false,
        error: "The AI returned an empty response. Try a clearer photo of the bio page.",
      };
    }

    const parsed = JSON.parse(text) as AiScanResult;
    return { ok: true, data: parsed };
  } catch (err) {
    // Log the raw error server-side, surface a clean, classified message.
    console.error("[scanPassport] scan failed:", err);
    return { ok: false, error: friendlyGeminiMessage(err, "passport") };
  }
}
