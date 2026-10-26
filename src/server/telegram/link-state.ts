import { timingSafeEqual } from "node:crypto";
import { randomToken } from "@/server/lib/hash";

export const TELEGRAM_LINK_STATE_COOKIE = "tg_link_state";
export const TELEGRAM_LINK_STATE_HEADER = "x-tg-link-state";

export type TelegramLinkStateCookie = {
  name: typeof TELEGRAM_LINK_STATE_COOKIE;
  value: string;
  httpOnly: true;
  sameSite: "lax";
  path: "/";
  maxAge: 900;
  secure: boolean;
};

export function issueTelegramLinkState(): { state: string; cookie: TelegramLinkStateCookie } {
  const state = randomToken();
  return {
    state,
    cookie: {
      name: TELEGRAM_LINK_STATE_COOKIE,
      value: state,
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 900,
      secure: process.env.NODE_ENV === "production",
    },
  };
}

export function telegramLinkStatesMatch(pathState: string, cookieState: string | null | undefined) {
  if (!cookieState) return false;
  const left = Buffer.from(pathState);
  const right = Buffer.from(cookieState);
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
