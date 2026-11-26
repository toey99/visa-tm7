"use server";

// =============================================================
// scanTicket — read one flight document for the /itinerary page
// =============================================================
// Accepts a PDF or a photo: a Trip.com itinerary, an airline boarding pass
// (Nok Air / Lion Air text PDFs, AirAsia picture PDFs), or a passport bio
// page (only to pick up the Chinese name). Returns a ScanDoc that the page
// folds into the trip with mergeDoc (src/lib/itinerary/types.ts).

import { GoogleGenAI, Type } from "@google/genai";
import { friendlyGeminiMessage, isTransientGeminiError } from "@/lib/geminiError";
import type { ScanDoc, ScanLeg, ScanPassenger } from "@/lib/itinerary/types";

export type ScanTicketResponse = { ok: true; data: ScanDoc } | { ok: false; error: string };

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PROMPT = `You are reading ONE travel document for a travel agent. It is one of:
(a) a flight booking itinerary (e.g. from Trip.com), possibly printed twice in two languages;
(b) an airline boarding pass (Nok Air, AirAsia, Thai Lion Air, Thai Vietjet ...), possibly printed twice (passenger copy + airline copy);
(c) the bio-data page of a passport.

Return JSON matching the schema.

"kind": "ticket" for (a) or (b), "passport" for (c), "other" if it is none of these.

If kind is "passport": fill "passport.surname" and "passport.given" in UPPERCASE Latin letters exactly as printed, and "passport.cnName" with the name in Chinese characters exactly as printed (surname first, no spaces). If no Chinese name is printed, use "". Return "legs" as an empty array.

If kind is "ticket": leave the passport fields "" and return one entry in "legs" per flight segment.
- NEVER list the same flight segment twice. If the document repeats itself (second language, airline copy), merge the copies.
- "airline": the airline's name as printed. "flightNo": airline code + number without spaces, e.g. DD102, FD3210, SL545, VZ135. If only a number is printed (Nok Air boarding passes print "FLIGHT NUMBER: 109"), return just the number.
- "date": the departure date as DD/MM/YYYY.
- "from" / "to": 3-letter IATA airport codes. Bangkok Don Mueang = DMK, Bangkok Suvarnabhumi = BKK, Chiang Rai (Mae Fah Luang) = CEI, Chiang Mai = CNX, Phuket = HKT.
- "fromTerminal" / "toTerminal": like "T2" when a terminal is printed for that airport, else "".
- "depTime", "arrTime", "boardTime": 24-hour HH:MM. Use "" for any time that is NOT printed. Do not compute or guess a time: a boarding pass that shows only a boarding time has depTime "".
- "gate": the gate if printed, else "".
- "passengers": every passenger on that segment. "surname" and "given" in UPPERCASE Latin letters. Itineraries label them "(First name)" and "(Last name)"; boarding passes usually print the name once, as "SURNAME GIVEN" or "GIVEN SURNAME" with a title such as MR, which you must drop. Chinese surnames are single short words (MA, LI, LIU, ZHANG, WANG, DONG ...): use that to decide which part is the surname.
- "pnr": the airline booking reference / record locator / confirmation code for that passenger on that segment (6 characters, e.g. VQPJ9R). It can differ between passengers and between segments. Never use the long numeric travel-agency booking number.
- "seat": the seat if printed, else "".
- "hasBoardingPass": true only if this document is a boarding pass for that passenger on that segment; false for a booking itinerary.

Never invent a value. Return only the JSON object.`;

const str = { type: Type.STRING };
const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    kind: { type: Type.STRING, enum: ["ticket", "passport", "other"] },
    passport: {
      type: Type.OBJECT,
      properties: { surname: str, given: str, cnName: str },
      required: ["surname", "given", "cnName"],
    },
    legs: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          airline: str, flightNo: str, date: str, from: str, to: str, fromTerminal: str, toTerminal: str,
          depTime: str, arrTime: str, boardTime: str, gate: str,
          passengers: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: { surname: str, given: str, pnr: str, seat: str, hasBoardingPass: { type: Type.BOOLEAN } },
              required: ["surname", "given", "pnr", "seat", "hasBoardingPass"],
            },
          },
        },
        required: ["airline", "flightNo", "date", "from", "to", "fromTerminal", "toTerminal", "depTime", "arrTime", "boardTime", "gate", "passengers"],
      },
    },
  },
  required: ["kind", "passport", "legs"],
};

function sniffMime(b: Uint8Array): string | null {
  if (b.length >= 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function cleanDoc(raw: unknown): ScanDoc {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const p = (r.passport && typeof r.passport === "object" ? r.passport : {}) as Record<string, unknown>;
  const kind = r.kind === "ticket" || r.kind === "passport" ? r.kind : "other";
  const legs: ScanLeg[] = (Array.isArray(r.legs) ? r.legs : []).map((l) => {
    const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
    const passengers: ScanPassenger[] = (Array.isArray(o.passengers) ? o.passengers : []).map((x) => {
      const q = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
      return { surname: s(q.surname), given: s(q.given), pnr: s(q.pnr), seat: s(q.seat), hasBoardingPass: q.hasBoardingPass === true };
    });
    return {
      airline: s(o.airline), flightNo: s(o.flightNo), date: s(o.date), from: s(o.from), to: s(o.to),
      fromTerminal: s(o.fromTerminal), toTerminal: s(o.toTerminal), depTime: s(o.depTime), arrTime: s(o.arrTime),
      boardTime: s(o.boardTime), gate: s(o.gate), passengers,
    };
  });
  return { kind, passport: { surname: s(p.surname), given: s(p.given), cnName: s(p.cnName) }, legs };
}

export async function scanTicket(formData: FormData): Promise<ScanTicketResponse> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "Server is missing GEMINI_API_KEY." };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "ไม่พบไฟล์" };
  if (file.size > MAX_BYTES) {
    return { ok: false, error: `ไฟล์ ${(file.size / 1024 / 1024).toFixed(1)} MB ใหญ่เกินไป (สูงสุด 4 MB)` };
  }

  try {
    const bytes = await file.arrayBuffer();
    const mimeType = sniffMime(new Uint8Array(bytes));
    if (!mimeType) return { ok: false, error: "รองรับเฉพาะ PDF, JPG, PNG หรือ WebP" };

    const ai = new GoogleGenAI({ apiKey });
    const request = {
      model: "gemini-2.5-flash",
      contents: [
        { role: "user", parts: [{ inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") } }, { text: PROMPT }] },
      ],
      config: { responseMimeType: "application/json", responseSchema: SCHEMA, temperature: 0 },
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
    if (!text) return { ok: false, error: "AI ไม่ได้ส่งผลกลับมา ลองอีกครั้ง" };

    const data = cleanDoc(JSON.parse(text));
    console.log("[scanTicket]", { file: file.name, kind: data.kind, legs: data.legs.length });
    return { ok: true, data };
  } catch (err) {
    console.error("[scanTicket] failed:", err);
    return { ok: false, error: friendlyGeminiMessage(err, "ticket") };
  }
}
