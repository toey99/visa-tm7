// Transfer-slip room — read one forwarded picture (server only)
import { GoogleGenAI, Type } from "@google/genai";
import { isTransientGeminiError } from "@/lib/geminiError";

export type SlipRead = { isSlip: boolean; amount: number; paidDate: string; paidTime: string; sender: string; bank: string; receiver: string; ref: string };

const PROMPT = `This picture should be a Thai bank money-transfer slip (e-slip from a mobile banking app: Bangkok Bank, K PLUS / Kasikorn, SCB, Krungthai, Krungsri, ttb, GSB, PromptPay …).
Return JSON matching the schema.

- "isSlip": true only when it is a completed transfer / payment slip showing an amount. Anything else (chat screenshot, document, photo, a list of numbers) → false, and leave the other fields empty / 0.
- "amount": the transferred amount in baht as a number (21,700.00 → 21700). NOT the fee, not the balance.
- "date": the transfer date as DD/MM/YYYY in the Gregorian calendar. Thai slips print Buddhist-era years: "14 พ.ย. 69" or "14 พ.ย. 2569" is 14/11/2026 (subtract 543; a 2-digit year 69 means 2569).
  Thai months: ม.ค.=01 ก.พ.=02 มี.ค.=03 เม.ย.=04 พ.ค.=05 มิ.ย.=06 ก.ค.=07 ส.ค.=08 ก.ย.=09 ต.ค.=10 พ.ย.=11 ธ.ค.=12.
- "time": HH:MM (24-hour) as printed.
- "sender": the name of the account the money came FROM, as printed. "senderBank": that account's bank, short Thai or English name as printed.
- "receiver": the name of the account / PromptPay the money went TO, as printed.
- "ref": the bank's transaction reference — the long "เลขที่อ้างอิง" / "เลขที่รายการ" / "รหัสอ้างอิง" / "Transaction ID" value, exactly as printed. When two are shown, give the LONGER one.
Unreadable or missing text → "" (amount 0). Never guess.`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function readSlipImage(bytes: ArrayBuffer, mimeType: string): Promise<SlipRead> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Server is missing GEMINI_API_KEY");
  const ai = new GoogleGenAI({ apiKey });
  const keys = ["isSlip", "amount", "date", "time", "sender", "senderBank", "receiver", "ref"];
  const request = {
    model: "gemini-2.5-flash",
    contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") } }, { text: PROMPT }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          isSlip: { type: Type.BOOLEAN },
          amount: { type: Type.NUMBER },
          date: { type: Type.STRING },
          time: { type: Type.STRING },
          sender: { type: Type.STRING },
          senderBank: { type: Type.STRING },
          receiver: { type: Type.STRING },
          ref: { type: Type.STRING },
        },
        required: keys,
        propertyOrdering: keys,
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
  const j = JSON.parse(text) as { isSlip?: boolean; amount?: number; date?: string; time?: string; sender?: string; senderBank?: string; receiver?: string; ref?: string };
  const s = (v?: string) => (v ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const amount = typeof j.amount === "number" && Number.isFinite(j.amount) && j.amount > 0 && j.amount < 100_000_000 ? Math.round(j.amount * 100) / 100 : 0;
  const date = s(j.date), time = s(j.time);
  return {
    isSlip: !!j.isSlip,
    amount,
    paidDate: /^\d{2}\/\d{2}\/\d{4}$/.test(date) ? date : "",
    paidTime: /^\d{1,2}:\d{2}/.test(time) ? time.slice(0, 5).padStart(5, "0") : "",
    sender: s(j.sender),
    bank: s(j.senderBank),
    receiver: s(j.receiver),
    ref: s(j.ref).replace(/\s+/g, ""),
  };
}
