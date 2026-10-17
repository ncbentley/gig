import "dotenv/config";
import { adBotWebhookRequest } from "@/server/telegram/ad-bot";

async function main() {
  const token = process.env.TELEGRAM_AD_BOT_TOKEN;
  const secret = process.env.TELEGRAM_AD_BOT_WEBHOOK_SECRET;
  const appUrl = process.env.APP_URL;
  if (!token || !secret || !appUrl) {
    console.error("TELEGRAM_AD_BOT_TOKEN, TELEGRAM_AD_BOT_WEBHOOK_SECRET, and APP_URL are required.");
    process.exit(1);
  }
  const request = adBotWebhookRequest(appUrl, secret);
  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request.body),
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(body);
    process.exit(1);
  }
  console.log(body);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : "Webhook registration failed.");
  process.exit(1);
});
