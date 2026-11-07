"use server";

// =============================================================
// analyzeTm30 — read a TM.30 receipt PDF for the /today board.
// =============================================================
// Like scanTm30 (address fields, same rules) but ALSO returns the
// foreigner's name and passport number printed on the receipt, so the
// board can match each downloaded receipt to the right person by
// passport number regardless of what the immigration site named the file.

import { GoogleGenAI, Type } from "@google/genai";
import { friendlyGeminiMessage, isTransientGeminiError } from "@/lib/geminiError";

export type Tm30Analyzed = {
  firstName: string;
  lastName: string;
  passportNo: string;
  houseNo: string;
  road: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
};

export type Tm30AnalyzeResponse =
  | { ok: true; data: Tm30Analyzed }
  | { ok: false; error: string };

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

const PROMPT = `This is a Thai TM.30 "Receipt of Notification" (ใบรับแจ้งที่พัก) for a foreign resident, from the immigration website.
Return EXCLUSIVELY a JSON object with: { firstName, lastName, passportNo, houseNo, road, subDistrict, district, province, postalCode }.

Rules:
- firstName / lastName = the foreigner's given name(s) and surname as printed (UPPERCASE Latin letters). If only one name line is printed, put it all in lastName.
- passportNo = the foreigner's passport number as printed (UPPERCASE, no spaces).
- Address: translate/transliterate Thai to UPPERCASE English. "road" without the word ROAD; do NOT include soi, moo, alley or lane; "postalCode" digits only.
- Unreadable or missing → "". Do NOT guess. No prose, no markdown fences.`;

const FIELDS = ["firstName", "lastName", "passportNo", "houseNo", "road", "subDistrict", "district", "province", "postalCode"] as const;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasPdfMagicBytes(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
}

export async function analyzeTm30(formData: FormData): Promise<Tm30AnalyzeResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "Server is missing GEMINI_API_KEY." };

  const file = formData.get("document");
  if (!(file instanceof File)) return { ok: false, error: "No PDF was provided." };
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `PDF is ${(file.size / 1024 / 1024).toFixed(1)} MB; max 4 MB.` };
  }
  const bytes = await file.arrayBuffer();
  const byteView = new Uint8Array(bytes);
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") || hasPdfMagicBytes(byteView);
  if (!isPdf) return { ok: false, error: "File must be a PDF." };

  try {
    const ai = new GoogleGenAI({ apiKey });
    const base64 = Buffer.from(bytes).toString("base64");
    const properties: Record<string, { type: Type }> = {};
    for (const f of FIELDS) properties[f] = { type: Type.STRING };

    const request = {
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ inlineData: { mimeType: "application/pdf", data: base64 } }, { text: PROMPT }] },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: { type: Type.OBJECT, properties, required: [...FIELDS], propertyOrdering: [...FIELDS] },
      },
    };

    let text: string | undefined;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const response = await ai.models.generateContent(request);
        text = response.text;
        break;
      } catch (err) {
        if (isTransientGeminiError(err) && attempt < MAX_ATTEMPTS) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        throw err;
      }
    }
    if (!text) return { ok: false, error: "The AI returned an empty response." };

    const raw = JSON.parse(text) as Partial<Tm30Analyzed>;
    const data = {} as Tm30Analyzed;
    for (const f of FIELDS) data[f] = typeof raw[f] === "string" ? (raw[f] as string) : "";
    data.passportNo = data.passportNo.replace(/\s+/g, "").toUpperCase();
    return { ok: true, data };
  } catch (err) {
    console.error("[analyzeTm30] failed:", err);
    const detail = err instanceof Error ? err.message.slice(0, 160) : "";
    return { ok: false, error: `${friendlyGeminiMessage(err, "TM.30")}${detail ? ` [${detail}]` : ""}` };
  }
}
