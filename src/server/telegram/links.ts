import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/server/db";
import { sessions, telegramLinks } from "@/server/db/schema";

export class TelegramLinkError extends Error {
  constructor(readonly code: "telegram_taken" | "already_linked") {
    super(code);
    this.name = "TelegramLinkError";
  }
}

export async function findActiveLinkByTelegramId(telegramUserId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(telegramLinks)
    .where(and(eq(telegramLinks.telegramUserId, telegramUserId), isNull(telegramLinks.revokedAt)))
    .limit(1);
  return row ?? null;
}

export async function linkTelegram(input: {
  userId: string;
  telegramUserId: string;
  username: string | null;
  authDate: Date;
}) {
  const db = await getDb();
  const current = await findActiveLinkByTelegramId(input.telegramUserId);
  if (current && current.userId !== input.userId) throw new TelegramLinkError("telegram_taken");
  const [own] = await db
    .select()
    .from(telegramLinks)
    .where(and(eq(telegramLinks.userId, input.userId), isNull(telegramLinks.revokedAt)))
    .limit(1);
  if (own && own.telegramUserId !== input.telegramUserId) throw new TelegramLinkError("already_linked");
  if (own) {
    await db
      .update(telegramLinks)
      .set({ telegramUsername: input.username, authDate: input.authDate })
      .where(eq(telegramLinks.id, own.id));
    return own.id;
  }
  const [created] = await db
    .insert(telegramLinks)
    .values({
      userId: input.userId,
      telegramUserId: input.telegramUserId,
      telegramUsername: input.username,
      authDate: input.authDate,
    })
    .returning({ id: telegramLinks.id });
  return created!.id;
}

export async function revokeTelegramLink(userId: string) {
  const db = await getDb();
  await db
    .update(telegramLinks)
    .set({ revokedAt: new Date() })
    .where(and(eq(telegramLinks.userId, userId), isNull(telegramLinks.revokedAt)));
  await db.delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.source, "telegram")));
}
