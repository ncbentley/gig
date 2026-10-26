import { findActiveLinkByTelegramId, linkTelegram, TelegramLinkError } from "./links";
import { readPendingTelegram } from "./pending";

const TELEGRAM_ALREADY_CONNECTED = "That Telegram account is already connected. Sign in instead.";

export type PendingSignupLink = {
  telegramUserId: string;
  username: string | null;
  authDate: number;
};

export async function pendingLinkForSignup(
  cookie: string | undefined,
  secret: string,
  nowMs: number,
): Promise<PendingSignupLink | { error: string } | { clear: true } | null> {
  if (cookie === undefined) return null;
  if (!secret) return { clear: true };
  const payload = readPendingTelegram(cookie, secret, nowMs);
  if (!payload) return { clear: true };
  const existing = await findActiveLinkByTelegramId(payload.id);
  if (existing) return { error: TELEGRAM_ALREADY_CONNECTED };
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

export async function finishPendingTelegramSignup(input: {
  userId: string;
  pending: PendingSignupLink;
}): Promise<{ linked: true } | { error: string }> {
  try {
    await applyPendingTelegramSignup(input);
  } catch (error) {
    if (error instanceof TelegramLinkError) return { error: TELEGRAM_ALREADY_CONNECTED };
    throw error;
  }
  return { linked: true };
}
