import { timingSafeEqual } from "node:crypto";
import { appUrl } from "@/server/auth";
import { adBotReply } from "@/server/telegram/ad-bot";

const SECRET_HEADER = "x-telegram-bot-api-secret-token";

function secretMatches(got: string | null, expected: string) {
  if (!got) return false;
  const a = Buffer.from(got);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

type Incoming = {
  message?: {
    text?: unknown;
    chat?: { id?: unknown; type?: unknown };
  };
};

export async function POST(req: Request) {
  const token = process.env.TELEGRAM_AD_BOT_TOKEN;
  const secret = process.env.TELEGRAM_AD_BOT_WEBHOOK_SECRET;
  if (!token || !secret) return new Response("Bot is not configured.", { status: 503 });
  if (!secretMatches(req.headers.get(SECRET_HEADER), secret)) return new Response("Unauthorized.", { status: 401 });

  let update: Incoming;
  try {
    update = (await req.json()) as Incoming;
  } catch {
    return new Response("Invalid JSON.", { status: 400 });
  }

  const message = update.message;
  const chatId = message?.chat?.id;
  if (message?.chat?.type !== "private" || typeof message.text !== "string" || typeof chatId !== "number") {
    return new Response("Ignored.", { status: 200 });
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: adBotReply(message.text, appUrl()) }),
    });
    if (!res.ok) return new Response("Send failed.", { status: 500 });
  } catch {
    return new Response("Send failed.", { status: 500 });
  }
  return new Response("Sent.", { status: 200 });
}
