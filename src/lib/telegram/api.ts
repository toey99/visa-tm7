// =============================================================
// Telegram Bot API — the few calls the counter bot needs (server only)
// =============================================================
// Needs TELEGRAM_BOT_TOKEN (from @BotFather). The webhook is protected by a
// secret token derived from the bot token (Telegram echoes it in a header).
import { createHmac } from "node:crypto";

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("Server is missing TELEGRAM_BOT_TOKEN");
  return t;
}
const api = (method: string) => `https://api.telegram.org/bot${token()}/${method}`;

/** The secret Telegram sends back in x-telegram-bot-api-secret-token (1–256 chars, [A-Za-z0-9_-]). */
export function webhookSecret(): string {
  return createHmac("sha256", token()).update("tm7-telegram-webhook").digest("base64url").slice(0, 48);
}
export const hasTelegram = () => !!process.env.TELEGRAM_BOT_TOKEN;

export type TgResult<T = unknown> = { ok: true; result: T } | { ok: false; status: number; error: string };

async function call<T>(method: string, body: Record<string, unknown> | FormData): Promise<TgResult<T>> {
  try {
    const r = await fetch(api(method), body instanceof FormData
      ? { method: "POST", body }
      : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
    if (!r.ok || !j.ok) return { ok: false, status: r.status, error: j.description ?? `HTTP ${r.status}` };
    return { ok: true, result: j.result as T };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export type InlineButton = { text: string; callback_data: string };

export function tgSendMessage(chatId: number | string, text: string, opts: { replyTo?: number; buttons?: InlineButton[][] } = {}) {
  return call<{ message_id: number }>("sendMessage", {
    chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true,
    ...(opts.replyTo ? { reply_parameters: { message_id: opts.replyTo, allow_sending_without_reply: true } } : {}),
    ...(opts.buttons ? { reply_markup: { inline_keyboard: opts.buttons } } : {}),
  });
}

export function tgSendPhoto(chatId: number | string, png: ArrayBuffer | Uint8Array, filename: string, caption = "") {
  const fd = new FormData();
  fd.set("chat_id", String(chatId));
  if (caption) fd.set("caption", caption.slice(0, 1000));
  fd.set("photo", new File([png as BlobPart], filename, { type: "image/png" }));
  return call<{ message_id: number }>("sendPhoto", fd);
}

/** Same picture, but as a file — Telegram keeps the full resolution (photos are recompressed). */
export function tgSendDocument(chatId: number | string, png: ArrayBuffer | Uint8Array, filename: string, caption = "") {
  const fd = new FormData();
  fd.set("chat_id", String(chatId));
  if (caption) fd.set("caption", caption.slice(0, 1000));
  fd.set("document", new File([png as BlobPart], filename, { type: "image/png" }));
  return call<{ message_id: number }>("sendDocument", fd);
}

export function tgAnswerCallback(id: string, text = "") {
  return call("answerCallbackQuery", { callback_query_id: id, text: text.slice(0, 200) });
}
export function tgEditMessageText(chatId: number | string, messageId: number, text: string, buttons?: InlineButton[][]) {
  return call("editMessageText", { chat_id: chatId, message_id: messageId, text: text.slice(0, 4000), ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}) });
}
export function tgSetWebhook(url: string) {
  return call("setWebhook", { url, secret_token: webhookSecret(), allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
}
export function tgGetWebhookInfo() { return call("getWebhookInfo", {}); }
export function tgSetCommands(commands: { command: string; description: string }[]) { return call("setMyCommands", { commands }); }
export function tgGetFile(fileId: string) { return call<{ file_path: string }>("getFile", { file_id: fileId }); }
export async function tgDownload(filePath: string): Promise<ArrayBuffer> {
  const r = await fetch(`https://api.telegram.org/file/bot${token()}/${filePath}`, { cache: "no-store" });
  if (!r.ok) throw new Error(`Telegram file ${r.status}`);
  return r.arrayBuffer();
}

// ---------- update shapes (only what we read) ----------
export type TgUser = { id: number; first_name?: string; last_name?: string; username?: string };
export type TgChat = { id: number; type: "private" | "group" | "supergroup" | "channel"; title?: string };
export type TgMessage = { message_id: number; date: number; chat: TgChat; from?: TgUser; text?: string; caption?: string; photo?: { file_id: string; width: number; height: number }[]; document?: { file_id: string; mime_type?: string; file_name?: string } };
export type TgUpdate = { update_id: number; message?: TgMessage; callback_query?: { id: string; from: TgUser; message?: TgMessage; data?: string } };
