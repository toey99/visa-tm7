// =============================================================
// 90-day report board — read one forwarded picture (server only)
// =============================================================
// One Gemini call decides what the picture is (passport bio page, 90-day
// receipt slip, or anything else) and pulls out the few fields the board needs.

import { GoogleGenAI, Type } from "@google/genai";
import { isTransientGeminiError } from "@/lib/geminiError";
import type { D90Kind } from "@/lib/d90/types";

export type D90Read = { kind: D90Kind; name: string; cn: string; passportNo: string; nationality: string; nextDue: string };

const PROMPT = `You are sorting pictures for a Thai immigration 90-day report (TM.47) service.
Decide what this picture is and extract a few fields. Return JSON matching the schema.

"kind":
- "passport" — the BIO-DATA page of a passport (holder's photo, name, passport number, machine-readable lines).
- "slip" — a Thai Immigration "RECEIPT OF NOTIFICATION" for staying in the Kingdom over 90 days (ใบรับแจ้งการอยู่ในราชอาณาจักรเกิน 90 วัน). It carries the person's name, nationality and a box saying to notify the address again on a date.
- "other" — anything else: entry/exit stamp pages, visa stickers, TM.6, TM.30, selfies, screenshots, chats.

Fields (UPPERCASE English; "" when not printed or unreadable — never guess):
- "surname", "givenNames": for a passport, exactly as printed on the bio page. For a slip, put the whole name as printed into "surname" and leave "givenNames" empty; drop titles and "( MALE )" / "( FEMALE )".
- "chineseName": passports only — the holder's name in Chinese characters exactly as printed on the bio page (e.g. 李忠; Chinese passports print it beside 姓名). "" when the page shows no Chinese-character name. Never translate or transliterate a name into Chinese.
- "passportNo": the passport number if printed on this picture.
- "nationality": English demonym (CHINESE, VIETNAMESE, MALAYSIAN, INDONESIAN, MYANMAR …).
- "nextDue": slips only — the date in the "notify your address again on" box, as DD/MM/YYYY in the Gregorian calendar (a Buddhist-era year such as 2570 means 2027).
For kind "other": if the page is a visa sticker, e-visa or similar that clearly prints the holder's name and/or passport number, fill "surname" (whole name as printed), "passportNo" and "nationality"; an entry-stamp page or anything without them gets "" everywhere. "chineseName" and "nextDue" stay "" for kind "other".`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function readD90Image(bytes: ArrayBuffer, mimeType: string): Promise<D90Read> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Server is missing GEMINI_API_KEY");
  const ai = new GoogleGenAI({ apiKey });
  const request = {
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") } }, { text: PROMPT }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          kind: { type: Type.STRING, enum: ["passport", "slip", "other"] },
          surname: { type: Type.STRING },
          givenNames: { type: Type.STRING },
          chineseName: { type: Type.STRING },
          passportNo: { type: Type.STRING },
          nationality: { type: Type.STRING },
          nextDue: { type: Type.STRING },
        },
        required: ["kind", "surname", "givenNames", "chineseName", "passportNo", "nationality", "nextDue"],
        propertyOrdering: ["kind", "surname", "givenNames", "chineseName", "passportNo", "nationality", "nextDue"],
      },
    },
  };

  let text: string | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      text = (await ai.models.generateContent(request)).text;
      break;
    } catch (err) {
      if (isTransientGeminiError(err) && attempt < 3) { await sleep(1500); continue; }
      throw err;
    }
  }
  if (!text) throw new Error("empty AI response");
  const j = JSON.parse(text) as { kind?: string; surname?: string; givenNames?: string; chineseName?: string; passportNo?: string; nationality?: string; nextDue?: string };
  const kind: D90Kind = j.kind === "passport" || j.kind === "slip" ? j.kind : "other";
  const clean = (s?: string) => (s ?? "").toUpperCase().replace(/\s+/g, " ").trim();
  // surname first, always
  const name = clean(`${j.surname ?? ""} ${j.givenNames ?? ""}`).replace(/\(\s*(FE)?MALE\s*\)/g, "").replace(/^(MR|MRS|MISS|MS)\.?\s+/, "").trim();
  const due = clean(j.nextDue);
  return {
    kind,
    name,
    cn: kind === "passport" ? (j.chineseName ?? "").replace(/[^\u3400-\u9fff·]/g, "") : "",
    passportNo: clean(j.passportNo).replace(/[^A-Z0-9]/g, ""),
    nationality: clean(j.nationality),
    nextDue: kind === "slip" && /^\d{2}\/\d{2}\/\d{4}$/.test(due) ? due : "",
  };
}

export function sniffImageMime(b: Uint8Array): string {
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  return "image/jpeg";
}
