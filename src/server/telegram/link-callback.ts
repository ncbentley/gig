import { verifyLoginWidget } from "./link-proof";
import { linkTelegram, TelegramLinkError } from "./links";
import { signPendingTelegram } from "./pending";

const PENDING_MAX_AGE_SECONDS = 15 * 60;

export type TelegramLinkCookie = {
  name: "tg_pending";
  value: string;
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  maxAge: 900;
  secure: boolean;
};

export type TelegramLinkDecision = {
  redirect: string;
  setCookie?: TelegramLinkCookie;
};

export async function decideTelegramLink(input: {
  fields: Record<string, string>;
  userId: string | null;
  botToken: string | undefined;
  appSecret: string | undefined;
  nowSeconds: number;
}): Promise<TelegramLinkDecision> {
  const { fields, userId, botToken, appSecret, nowSeconds } = input;
  if (!botToken || (userId === null && !appSecret)) return { redirect: "/account?telegram=unconfigured" };

  const proof = verifyLoginWidget(fields, botToken, nowSeconds);
  if (!proof) return { redirect: "/account?telegram=invalid" };

  if (userId === null) {
    if (!appSecret) return { redirect: "/account?telegram=unconfigured" };
    const exp = nowSeconds * 1000 + PENDING_MAX_AGE_SECONDS * 1000;
    return {
      redirect: "/signup?telegram=1",
      setCookie: {
        name: "tg_pending",
        value: signPendingTelegram(
          { id: proof.telegramUserId, username: proof.username, authDate: proof.authDate, exp },
          appSecret,
        ),
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 900,
        secure: process.env.NODE_ENV === "production",
      },
    };
  }

  try {
    await linkTelegram({
      userId,
      telegramUserId: proof.telegramUserId,
      username: proof.username,
      authDate: new Date(proof.authDate * 1000),
    });
  } catch (error) {
    if (error instanceof TelegramLinkError && error.code === "telegram_taken") return { redirect: "/account?telegram=taken" };
    if (error instanceof TelegramLinkError && error.code === "already_linked") return { redirect: "/account?telegram=already" };
    throw error;
  }
  return { redirect: "/account?telegram=connected" };
}
