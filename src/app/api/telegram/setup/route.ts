// GET /api/telegram/setup — registers this site's webhook with Telegram (and
// the slash-command menu). Open it once in the browser while signed in, after
// TELEGRAM_BOT_TOKEN is set on Vercel. Safe to open again any time.
import { NextRequest, NextResponse } from "next/server";
import { hasTelegram, tgGetWebhookInfo, tgSetCommands, tgSetWebhook } from "@/lib/telegram/api";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  if (!hasTelegram()) return NextResponse.json({ error: "ยังไม่ได้ตั้ง TELEGRAM_BOT_TOKEN บน Vercel (Settings → Environment Variables) แล้ว redeploy" }, { status: 500 });
  const origin = process.env.PUBLIC_ORIGIN ?? req.nextUrl.origin;
  const hook = await tgSetWebhook(`${origin}/api/telegram/webhook`);
  const cmds = await tgSetCommands([
    { command: "help", description: "วิธีใช้ / รายการคำสั่ง" },
    { command: "board", description: "หน้างานตั้งต้นของแชทนี้ เช่น /board it" },
    { command: "pic", description: "รูป Summary อัตโนมัติ on / off" },
    { command: "users", description: "ใครสั่งบอทได้บ้าง" },
    { command: "allow", description: "อนุญาตคนใหม่ /allow <id>" },
  ]);
  const info = await tgGetWebhookInfo();
  return NextResponse.json({ webhook: hook, commands: cmds, info }, { headers: { "Cache-Control": "no-store" } });
}
