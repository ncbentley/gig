import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { decideTelegramLink } from "@/server/telegram/link-callback";

function fieldsFromSearch(searchParams: URLSearchParams): Record<string, string> | null {
  const fields: Record<string, string> = {};
  for (const [key, value] of searchParams) {
    if (Object.hasOwn(fields, key)) return null;
    fields[key] = value;
  }
  return fields;
}

export async function GET(request: Request) {
  const fields = fieldsFromSearch(new URL(request.url).searchParams);
  if (!fields) redirect("/account?telegram=invalid");

  const user = await getCurrentUser();
  const decision = await decideTelegramLink({
    fields,
    userId: user?.id ?? null,
    botToken: process.env.TELEGRAM_LINK_BOT_TOKEN,
    appSecret: process.env.APP_SECRET,
    nowSeconds: Math.floor(Date.now() / 1000),
  });

  if (decision.setCookie) {
    const jar = await cookies();
    jar.set(decision.setCookie);
  }
  redirect(decision.redirect);
}
