import { findActiveLinkByTelegramId, linkTelegram } from "./links";
import { readPendingTelegram } from "./pending";

export type PendingSignupLink = {
  telegramUserId: string;
  username: string | null;
  authDate: number;
};

export async function pendingLinkForSignup(
  cookie: string | undefined,
  secret: string,
  nowMs: number,
): Promise<PendingSignupLink | { error: string } | null> {
  if (!cookie || !secret) return null;
  const payload = readPendingTelegram(cookie, secret, nowMs);
  if (!payload) return null;
  const existing = await findActiveLinkByTelegramId(payload.id);
  if (existing) return { error: "That Telegram account is already connected. Sign in instead." };
  return { telegramUserId: payload.id, username: payload.username, authDate: payload.authDate };
}

export async function applyPendingTelegramSignup(input: { userId: string; pending: PendingSignupLink }) {
  await linkTelegram({
    userId: input.userId,
    telegramUserId: input.pending.telegramUserId,
    username: input.pending.username,
    authDate: new Date(input.pending.authDate * 1000),
  });
}
