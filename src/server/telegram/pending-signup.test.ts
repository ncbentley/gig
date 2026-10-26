import { count, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { telegramLinks, users } from "@/server/db/schema";
import { linkTelegram } from "./links";
import { signPendingTelegram } from "./pending";
import { applyPendingTelegramSignup, finishPendingTelegramSignup, pendingLinkForSignup } from "./pending-signup";

const secret = "app-secret";
const nowMs = 1_700_000_000_000;
const authDate = 1_700_000_000;

function pendingCookie(id: string, username: string | null = "ada") {
  return signPendingTelegram({ id, username, authDate, exp: nowMs + 60_000 }, secret);
}

async function userCount() {
  const db = await getDb();
  const [row] = await db.select({ n: count() }).from(users);
  return Number(row!.n);
}

beforeAll(async () => {
  await runMigrations();
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("pendingLinkForSignup", () => {
  it("returns the telegram id for a new pending cookie and rejects an already connected id without inserting a user", async () => {
    const telegramUserId = "424242";
    const before = await userCount();
    const fresh = await pendingLinkForSignup(pendingCookie(telegramUserId), secret, nowMs);

    expect(fresh).toEqual({ telegramUserId, username: "ada", authDate });
    expect(await userCount()).toBe(before);

    const db = await getDb();
    const [owner] = await db
      .insert(users)
      .values({ email: `tg-taken-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
      .returning({ id: users.id });
    await linkTelegram({
      userId: owner!.id,
      telegramUserId,
      username: "ada",
      authDate: new Date(authDate * 1000),
    });

    const linkedCount = await userCount();
    const taken = await pendingLinkForSignup(pendingCookie(telegramUserId, "other"), secret, nowMs);

    expect(taken).toEqual({ error: "That Telegram account is already connected. Sign in instead." });
    expect(await userCount()).toBe(linkedCount);

    await db.delete(users).where(eq(users.id, owner!.id));
  });

  it("returns null when the cookie is missing", async () => {
    expect(await pendingLinkForSignup(undefined, secret, nowMs)).toBeNull();
    expect(await pendingLinkForSignup(undefined, "", nowMs)).toBeNull();
  });

  it("reports a present cookie that cannot be read as clear", async () => {
    const cookie = pendingCookie("7");
    const [mac, body] = cookie.split(".");
    const flipped = `${mac!.slice(0, -1)}${mac!.endsWith("0") ? "1" : "0"}.${body}`;
    const expired = signPendingTelegram({ id: "7", username: "ada", authDate, exp: nowMs }, secret);
    const badId = signPendingTelegram({ id: "nope", username: null, authDate, exp: nowMs + 60_000 }, secret);

    expect(await pendingLinkForSignup(flipped, secret, nowMs)).toEqual({ clear: true });
    expect(await pendingLinkForSignup(expired, secret, nowMs)).toEqual({ clear: true });
    expect(await pendingLinkForSignup(badId, secret, nowMs)).toEqual({ clear: true });
    expect(await pendingLinkForSignup(cookie, "", nowMs)).toEqual({ clear: true });
    expect(await pendingLinkForSignup("not-a-cookie", secret, nowMs)).toEqual({ clear: true });
  });
});

describe("applyPendingTelegramSignup", () => {
  it("links the new user to the pending telegram account", async () => {
    const telegramUserId = "515151";
    const pending = await pendingLinkForSignup(pendingCookie(telegramUserId), secret, nowMs);
    if (!pending || !("telegramUserId" in pending)) throw new Error("expected a pending telegram payload");

    const db = await getDb();
    const [user] = await db
      .insert(users)
      .values({ email: `tg-new-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
      .returning({ id: users.id });

    await applyPendingTelegramSignup({ userId: user!.id, pending });

    const userRows = await db.select({ id: users.id }).from(users).where(eq(users.id, user!.id));
    const links = await db.select().from(telegramLinks).where(eq(telegramLinks.userId, user!.id));

    expect(userRows).toHaveLength(1);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      telegramUserId,
      telegramUsername: "ada",
      revokedAt: null,
    });
    expect(links[0]!.authDate.getTime()).toBe(authDate * 1000);

    await db.delete(users).where(eq(users.id, user!.id));
  });

  it("returns the taken error when linking throws and does not treat the signup as linked", async () => {
    const telegramUserId = "616161";
    const db = await getDb();
    const [owner] = await db
      .insert(users)
      .values({ email: `tg-owner-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
      .returning({ id: users.id });
    const [signup] = await db
      .insert(users)
      .values({ email: `tg-signup-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
      .returning({ id: users.id });
    await linkTelegram({
      userId: owner!.id,
      telegramUserId,
      username: "ada",
      authDate: new Date(authDate * 1000),
    });

    const before = await userCount();
    const result = await finishPendingTelegramSignup({
      userId: signup!.id,
      pending: { telegramUserId, username: "other", authDate },
    });

    expect(result).toEqual({ error: "That Telegram account is already connected. Sign in instead." });
    expect(result).not.toHaveProperty("linked");
    expect(result).not.toHaveProperty("clear");
    expect(await userCount()).toBe(before);

    const signupLinks = await db.select().from(telegramLinks).where(eq(telegramLinks.userId, signup!.id));
    const ownerLinks = await db.select().from(telegramLinks).where(eq(telegramLinks.userId, owner!.id));
    expect(signupLinks).toHaveLength(0);
    expect(ownerLinks).toHaveLength(1);
    expect(ownerLinks[0]).toMatchObject({ telegramUserId, revokedAt: null });

    await db.delete(users).where(eq(users.id, signup!.id));
    await db.delete(users).where(eq(users.id, owner!.id));
  });
});
