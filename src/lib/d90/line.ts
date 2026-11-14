// =============================================================
// LINE Messaging API — the few calls the 90-day inbox bot needs (server only)
// =============================================================
// Needs LINE_CHANNEL_SECRET and LINE_CHANNEL_ACCESS_TOKEN.
// The bot only ever uses REPLY messages (free) — never push.

import { createHmac, timingSafeEqual } from "node:crypto";

function accessToken(): string {
  const t = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!t) throw new Error("Server is missing LINE_CHANNEL_ACCESS_TOKEN");
  return t;
}

/** x-line-signature = base64(HMAC-SHA256(channel secret, raw body)) */
export function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const want = createHmac("sha256", secret).update(rawBody).digest();
  let got: Buffer;
  try { got = Buffer.from(signature, "base64"); } catch { return false; }
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function lineGetContent(messageId: string): Promise<ArrayBuffer> {
  const r = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(messageId)}/content`, {
    headers: { authorization: `Bearer ${accessToken()}` },
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`LINE content ${r.status}`);
  return r.arrayBuffer();
}

export async function lineReply(replyToken: string | undefined, text: string | string[]): Promise<void> {
  const texts = (Array.isArray(text) ? text : [text]).filter(Boolean).slice(0, 5);
  if (!replyToken || !texts.length) return;
  try {
    const r = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken()}`, "content-type": "application/json" },
      body: JSON.stringify({ replyToken, messages: texts.map((t) => ({ type: "text", text: t.slice(0, 4800) })) }),
    });
    if (!r.ok) console.warn("[line] reply failed", r.status, (await r.text()).slice(0, 200));
  } catch (e) {
    console.warn("[line] reply failed", e);
  }
}

export async function lineGroupName(groupId: string): Promise<string> {
  try {
    const r = await fetch(`https://api.line.me/v2/bot/group/${encodeURIComponent(groupId)}/summary`, {
      headers: { authorization: `Bearer ${accessToken()}` },
      cache: "no-store",
    });
    if (!r.ok) return "";
    return ((await r.json()) as { groupName?: string }).groupName ?? "";
  } catch {
    return "";
  }
}

export type LineEvent = {
  type: string;
  timestamp: number;
  replyToken?: string;
  source?: { type: string; groupId?: string; roomId?: string; userId?: string };
  message?: {
    id: string;
    type: string;
    text?: string;
    contentProvider?: { type: string };
    imageSet?: { id: string; index?: number; total?: number };
  };
};
