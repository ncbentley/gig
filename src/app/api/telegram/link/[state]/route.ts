import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { decideTelegramLink } from "@/server/telegram/link-callback";
import { TELEGRAM_LINK_STATE_COOKIE, telegramLinkStatesMatch } from "@/server/telegram/link-state";

function fieldsFromSearch(searchParams: URLSearchParams): Record<string, string> | null {
  const fields: Record<string, string> = {};
  for (const [key, value] of searchParams) {
    if (Object.hasOwn(fields, key)) return null;
    fields[key] = value;
  }
  return fields;
}

export async function GET(request: Request, context: { params: Promise<{ state: string }> }) {
  const fields = fieldsFromSearch(new URL(request.url).searchParams);
  if (!fields) redirect("/account?telegram=invalid");

  const { state } = await context.params;
  const jar = await cookies();
  const cookieState = jar.get(TELEGRAM_LINK_STATE_COOKIE)?.value ?? null;
  if (!telegramLinkStatesMatch(state, cookieState)) redirect("/account?telegram=invalid");

  const user = await getCurrentUser();
  const decision = await decideTelegramLink({
    fields,
    userId: user?.id ?? null,
    botToken: process.env.TELEGRAM_LINK_BOT_TOKEN,
    appSecret: process.env.APP_SECRET,
    nowSeconds: Math.floor(Date.now() / 1000),
    pathState: state,
    cookieState,
  });

  if (decision.setCookie) jar.set(decision.setCookie);
  if (decision.clearState) {
    jar.set(TELEGRAM_LINK_STATE_COOKIE, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      secure: process.env.NODE_ENV === "production",
    });
  }
  redirect(decision.redirect);
}
