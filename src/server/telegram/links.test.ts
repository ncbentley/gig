import { and, eq, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { sessions, telegramLinks, users } from "@/server/db/schema";
import {
  findActiveLinkByTelegramId,
  linkTelegram,
  revokeTelegramLink,
} from "./links";

beforeAll(async () => {
  await runMigrations();
}, 60_000);

afterAll(async () => {
  await closeDb();
});

async function createTestUsers() {
  const db = await getDb();
  const [userA] = await db
    .insert(users)
    .values({ email: `tg-a-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
    .returning({ id: users.id });
  const [userB] = await db
    .insert(users)
    .values({ email: `tg-b-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
    .returning({ id: users.id });
  return { userA: userA!, userB: userB! };
}

describe("linkTelegram", () => {
  let userA: { id: string };
  let userB: { id: string };

  afterEach(async () => {
    const db = await getDb();
    await db.delete(users).where(eq(users.id, userA.id));
    await db.delete(users).where(eq(users.id, userB.id));
  });

  beforeEach(async () => {
    ({ userA, userB } = await createTestUsers());
  });

  it("inserts one active row with revokedAt null", async () => {
    const authDate = new Date(1_700_000_000_000);
    const linkId = await linkTelegram({
      userId: userA.id,
      telegramUserId: "42",
      username: "ada",
      authDate,
    });

    const db = await getDb();
    const rows = await db
      .select()
      .from(telegramLinks)
      .where(and(eq(telegramLinks.userId, userA.id), isNull(telegramLinks.revokedAt)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: linkId,
      telegramUserId: "42",
      telegramUsername: "ada",
      revokedAt: null,
    });
    expect(rows[0]!.authDate.getTime()).toBe(authDate.getTime());
  });

  it("updates telegram_username on re-link without a second active row", async () => {
    const authDate = new Date(1_700_000_000_000);
    const firstId = await linkTelegram({
      userId: userA.id,
      telegramUserId: "42",
      username: "ada",
      authDate,
    });
    const secondId = await linkTelegram({
      userId: userA.id,
      telegramUserId: "42",
      username: "ada2",
      authDate,
    });

    expect(secondId).toBe(firstId);
    const db = await getDb();
    const active = await db
      .select()
      .from(telegramLinks)
      .where(and(eq(telegramLinks.userId, userA.id), isNull(telegramLinks.revokedAt)));
    expect(active).toHaveLength(1);
    expect(active[0]!.telegramUsername).toBe("ada2");
  });

  it("throws telegram_taken and already_linked", async () => {
    await linkTelegram({
      userId: userA.id,
      telegramUserId: "42",
      username: "ada",
      authDate: new Date(1_700_000_000_000),
    });

    await expect(
      linkTelegram({
        userId: userB.id,
        telegramUserId: "42",
        username: "bob",
        authDate: new Date(1_700_000_000_000),
      }),
    ).rejects.toMatchObject({ name: "TelegramLinkError", code: "telegram_taken" });

    await expect(
      linkTelegram({
        userId: userA.id,
        telegramUserId: "99",
        username: "ada",
        authDate: new Date(1_700_000_000_000),
      }),
    ).rejects.toMatchObject({ name: "TelegramLinkError", code: "already_linked" });
  });
});

describe("revokeTelegramLink and findActiveLinkByTelegramId", () => {
  let userA: { id: string };
  let userB: { id: string };

  afterEach(async () => {
    const db = await getDb();
    await db.delete(users).where(eq(users.id, userA.id));
    await db.delete(users).where(eq(users.id, userB.id));
  });

  beforeEach(async () => {
    ({ userA, userB } = await createTestUsers());
  });

  it("revokes link, clears telegram sessions, allows re-link to another user", async () => {
    await linkTelegram({
      userId: userA.id,
      telegramUserId: "42",
      username: "ada",
      authDate: new Date(1_700_000_000_000),
    });

    const db = await getDb();
    const expiresAt = new Date(Date.now() + 86_400_000);
    const webSessionId = `web-${crypto.randomUUID()}`;
    const tgSessionId = `tg-${crypto.randomUUID()}`;
    await db.insert(sessions).values([
      { id: webSessionId, userId: userA.id, expiresAt, source: "web" },
      { id: tgSessionId, userId: userA.id, expiresAt, source: "telegram" },
    ]);

    await revokeTelegramLink(userA.id);

    expect(await findActiveLinkByTelegramId("42")).toBeNull();

    const revoked = await db
      .select()
      .from(telegramLinks)
      .where(eq(telegramLinks.telegramUserId, "42"));
    expect(revoked).toHaveLength(1);
    expect(revoked[0]!.revokedAt).not.toBeNull();

    const newLinkId = await linkTelegram({
      userId: userB.id,
      telegramUserId: "42",
      username: "bob",
      authDate: new Date(1_700_000_000_000),
    });
    expect(newLinkId).toBeTruthy();

    const tgSessions = await db.select().from(sessions).where(eq(sessions.id, tgSessionId));
    expect(tgSessions).toHaveLength(0);

    const webSessions = await db.select().from(sessions).where(eq(sessions.id, webSessionId));
    expect(webSessions).toHaveLength(1);
  });
});
