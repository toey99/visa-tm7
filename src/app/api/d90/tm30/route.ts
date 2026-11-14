// TM.30 for people on the 90-day board, from the officer's list of passport numbers.
// Signed-in users only (proxy).
// POST /api/d90/tm30  multipart: image (a photo of the list, handwritten or printed) → { numbers: [...] }
// GET  /api/d90/tm30?img=d90/img/YYYYMM/<id>.jpg → the passport page read again for the TM.30 upload sheet
//      → { title, firstName, lastName, nationality, dateOfBirth, passportNo }
//      (the 90-day board itself keeps only name + number; the TM.30 Excel also needs sex and birth date)
import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import { analyzeDoc } from "@/app/actions/analyzeDoc";
import { blobGetByPath } from "@/lib/blob";
import { friendlyGeminiMessage, isTransientGeminiError } from "@/lib/geminiError";

export const runtime = "nodejs";
export const maxDuration = 60;
const noStore = { headers: { "Cache-Control": "no-store" } };
const MAX = 4 * 1024 * 1024;

const PROMPT = `This picture is a list of PASSPORT NUMBERS, usually handwritten, sometimes with a short note after each one.
Return EXCLUSIVELY a JSON object { "numbers": [ ... ] } with every passport number on the page, top to bottom.
Rules:
- A passport number is 7-10 characters: letters and digits only, UPPERCASE, no spaces (e.g. EQ6134081, EK3966358, A20813131).
- Chinese passports are one or two letters followed by digits — when a character is ambiguous prefer a digit in the numeric part (0 not O, 1 not I, 2 not Z, 5 not S).
- Ignore crossed-out text, notes, ditto marks, names and anything that is not a passport number.
- Do NOT invent or complete numbers you cannot read; leave them out.`;

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Server is missing GEMINI_API_KEY." }, { status: 500 });
  try {
    const fd = await req.formData();
    const file = fd.get("image");
    if (!(file instanceof File) || !file.size) return NextResponse.json({ error: "image required" }, { status: 400 });
    if (file.size > MAX) return NextResponse.json({ error: "รูปใหญ่เกิน 4 MB" }, { status: 413 });
    const ai = new GoogleGenAI({ apiKey });
    const request = {
      model: "gemini-2.5-flash",
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: file.type || "image/jpeg", data: Buffer.from(await file.arrayBuffer()).toString("base64") } }, { text: PROMPT }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: { type: Type.OBJECT, properties: { numbers: { type: Type.ARRAY, items: { type: Type.STRING } } }, required: ["numbers"] },
      },
    };
    let text: string | undefined;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        text = (await ai.models.generateContent(request)).text;
        break;
      } catch (err) {
        if (isTransientGeminiError(err) && attempt < 3) { await new Promise((r) => setTimeout(r, 1500)); continue; }
        throw err;
      }
    }
    const raw = text ? (JSON.parse(text) as { numbers?: unknown[] }) : {};
    const numbers = Array.from(new Set((Array.isArray(raw.numbers) ? raw.numbers : [])
      .map((n) => String(n ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""))
      .filter((n) => n.length >= 6 && n.length <= 12 && /\d/.test(n))));
    return NextResponse.json({ numbers }, noStore);
  } catch (e) {
    return NextResponse.json({ error: friendlyGeminiMessage(e, "รายการเลขพาสปอร์ต") }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const img = req.nextUrl.searchParams.get("img") ?? "";
  if (!/^d90\/img\/\d{6}\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(img)) return NextResponse.json({ error: "bad path" }, { status: 400 });
  try {
    const r = await blobGetByPath(img);
    if (!r || !r.ok) return NextResponse.json({ error: "ไม่พบรูปพาสปอร์ต" }, { status: 404 });
    const mime = img.endsWith(".png") ? "image/png" : img.endsWith(".webp") ? "image/webp" : "image/jpeg";
    const fd = new FormData();
    fd.set("image", new File([await r.arrayBuffer()], `passport.${img.split(".").pop()}`, { type: mime }));
    const a = await analyzeDoc(fd);
    if (!a.ok) return NextResponse.json({ error: a.error }, { status: 502 });
    const d = a.data;
    return NextResponse.json({ title: d.title, firstName: d.firstName, lastName: d.lastName, nationality: d.nationality, dateOfBirth: d.dateOfBirth, passportNo: d.passportNo }, noStore);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "read failed" }, { status: 500 });
  }
}
