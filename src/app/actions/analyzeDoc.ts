"use server";

// =============================================================
// analyzeDoc — one Gemini call per uploaded image for the /today board.
// =============================================================
// Classifies the image (passport bio page / entry stamp page / selfie /
// TM.30 receipt / other) and, in the same call, extracts whatever fields
// that document type carries. This keeps the daily intake at one request
// per file instead of classify-then-scan round trips.
//
// Passport extraction rules mirror scanPassport.ts so the two flows agree.

import { GoogleGenAI, Type } from "@google/genai";
import { friendlyGeminiMessage, isTransientGeminiError } from "@/lib/geminiError";

export type DocType = "passport" | "stamp" | "selfie" | "tm30" | "other";

export type AnalyzedDoc = {
  docType: DocType;
  // passport
  title: "MR." | "MRS." | "MISS" | "";
  firstName: string;
  lastName: string;
  chineseName: string;          // name in CJK characters as printed, or ""
  nationality: string;          // demonym, e.g. CHINESE
  dateOfBirth: string;          // DD/MM/YYYY
  placeOfBirth: string;
  passportNo: string;
  passportIssueDate: string;    // DD/MM/YYYY
  passportExpiryDate: string;   // DD/MM/YYYY
  passportIssuedAt: string;
  photoBox: string;             // holder's photo on the bio page: "ymin,xmin,ymax,xmax" on a 0-1000 scale
  mrzLine1: string;             // first MRZ line (P<CCCSURNAME<<GIVEN<NAMES<<<...) transcribed exactly
  // entry stamp (latest Thai arrival stamp on the page)
  arrivalDate: string;          // DD/MM/YYYY — red date stamp inside the box
  admittedUntil: string;        // DD/MM/YYYY — blue "admitted until" date
  portOfArrival: string;        // e.g. SUVARNABHUMI AIRPORT
  arrivedBy: string;            // AIRPLANE | LAND | SHIP | ""
  visaType: string;             // text printed on the stamp, e.g. EXEMPTION, if any
  // tm30 receipt (address)
  houseNo: string;
  road: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
};

export type AnalyzeResponse =
  | { ok: true; data: AnalyzedDoc }
  | { ok: false; error: string };

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return "image/webp";
  return null;
}

const PROMPT = `You are sorting documents for a Thai visa-extension office. Look at this single image and classify it, then extract fields.

docType — exactly one of:
- "passport": the bio-data page of a passport (photo + MRZ lines at the bottom).
- "stamp": a passport visa page showing Thai immigration entry stamps (a red rectangular arrival stamp with port name and date; often a blue "ADMITTED UNTIL" date stamp).
- "selfie": a photo of a person's face/upper body (not a document).
- "tm30": a Thai TM.30 "Receipt of Notification" for residence (ใบรับแจ้งที่พัก) — a form with an address, from the immigration website.
- "other": anything else.

Field rules (fill only the fields that belong to the docType; everything else must be ""):
PASSPORT:
- All text values UPPERCASE English. "nationality" = English DEMONYM (CHINESE, BRITISH, AMERICAN, THAI...), never an ISO code or country.
- "title": "MR." for male; "MRS." for a female (use "MISS" only if clearly unmarried); otherwise "".
- "chineseName": the holder's name printed in Chinese characters (next to the Latin name on Chinese passports). "" if none.
- Dates DD/MM/YYYY. "passportNo" is the document number on the bio page (top-right), not the MRZ personal number.
- "mrzLine1": the FIRST line of the machine-readable zone at the bottom (44 characters, starts with "P<"), transcribed exactly with "<" fillers. The surname comes before "<<" and the given names after it — use this to decide which name is the surname.
- "photoBox": bounding box of the holder's printed photo as "ymin,xmin,ymax,xmax" with each value 0-1000 relative to the image size.
STAMP:
- Find the MOST RECENT Thai ARRIVAL stamp (red rectangular box). "arrivalDate" = the date inside/under that box, DD/MM/YYYY (dates on stamps are usually DD MMM YYYY like "12 OCT 2026" — convert).
- "admittedUntil" = the blue (sometimes black) "ADMITTED UNTIL" / "ALLOWED TO STAY UNTIL" date near that stamp, DD/MM/YYYY; "" if absent.
- "portOfArrival" = the port/checkpoint name on the stamp in UPPERCASE English (e.g. SUVARNABHUMI AIRPORT, DON MUEANG AIRPORT, ARANYAPRATHET, PHUKET AIRPORT).
- "arrivedBy": "AIRPLANE" if the port is an airport, "LAND" for a land border checkpoint, "SHIP" for a seaport, else "".
- "visaType": text on the stamp that names the entry type (e.g. "EXEMPTION", "TR", "VOA"), else "".
TM30:
- Address in UPPERCASE English (translate/transliterate Thai). "road" without the word ROAD; no soi/moo/alley; "postalCode" digits only.
- If a field is unreadable, return "". Do NOT guess.
Return only the JSON object.`;

const STRING = { type: Type.STRING };
const FIELDS = [
  "docType", "title", "firstName", "lastName", "chineseName", "nationality", "dateOfBirth", "placeOfBirth",
  "passportNo", "passportIssueDate", "passportExpiryDate", "passportIssuedAt", "photoBox", "mrzLine1",
  "arrivalDate", "admittedUntil", "portOfArrival", "arrivedBy", "visaType",
  "houseNo", "road", "subDistrict", "district", "province", "postalCode",
] as const;

export async function analyzeDoc(formData: FormData): Promise<AnalyzeResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "Server is missing GEMINI_API_KEY." };
  }
  const file = formData.get("image");
  if (!(file instanceof File)) return { ok: false, error: "No image was provided." };
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB; max 4 MB.` };
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
    const bytes = await file.arrayBuffer();
    const byteView = new Uint8Array(bytes);
    const mimeType = ["image/jpeg", "image/png", "image/webp"].includes(file.type) ? file.type : sniffImageMime(byteView);
    if (!mimeType) return { ok: false, error: "File must be a JPEG, PNG, or WebP image." };
    const base64 = Buffer.from(bytes).toString("base64");

    const properties: Record<string, { type: Type; enum?: string[] }> = {};
    for (const f of FIELDS) properties[f] = { ...STRING };
    properties.docType = { type: Type.STRING, enum: ["passport", "stamp", "selfie", "tm30", "other"] };

    const request = {
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ inlineData: { mimeType, data: base64 } }, { text: PROMPT }] },
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties,
          required: [...FIELDS],
          propertyOrdering: [...FIELDS],
        },
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

    const raw = JSON.parse(text) as Partial<AnalyzedDoc>;
    const data = {} as AnalyzedDoc;
    for (const f of FIELDS) {
      (data as unknown as Record<string, string>)[f] = typeof raw[f] === "string" ? (raw[f] as string) : "";
    }
    if (!["passport", "stamp", "selfie", "tm30", "other"].includes(data.docType)) data.docType = "other";
    if (!["MR.", "MRS.", "MISS"].includes(data.title)) data.title = "";
    // The MRZ is unambiguous about surname vs given names; the printed page is
    // not always (LU LIANG vs LIANG LU). Prefer the MRZ when it parses.
    const mrz = data.mrzLine1.toUpperCase().replace(/[^A-Z0-9<]/g, "");
    if (/^P[A-Z<][A-Z<]{3}/.test(mrz) && mrz.length >= 20) {
      const names = mrz.slice(5).split("<<");
      const surname = names[0].replace(/</g, " ").trim();
      const given = (names[1] ?? "").replace(/</g, " ").trim();
      if (surname && given && /^[A-Z ]+$/.test(surname + given)) {
        data.lastName = surname;
        data.firstName = given;
      }
    }
    return { ok: true, data };
  } catch (err) {
    console.error("[analyzeDoc] failed:", err);
    const detail = err instanceof Error ? err.message.slice(0, 160) : "";
    return { ok: false, error: `${friendlyGeminiMessage(err, "document")}${detail ? ` [${detail}]` : ""}` };
  }
}
