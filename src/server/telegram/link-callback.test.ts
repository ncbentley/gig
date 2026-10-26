import { createHash, createHmac } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { telegramLinks, users } from "@/server/db/schema";
import { decideTelegramLink } from "./link-callback";
import { readPendingTelegram } from "./pending";

const token = "123456:TEST";
const appSecret = "app-secret";
const nowSeconds = 1_700_000_100;

function compareKeys(a: string, b: string) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function widgetHash(fields: Record<string, string>, botToken: string) {
  const pairs = Object.entries(fields)
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => compareKeys(a, b));
  const check = pairs.map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHash("sha256").update(botToken).digest();
  return createHmac("sha256", secret).update(check).digest("hex");
}

function signedFields(overrides: Record<string, string> = {}) {
  const fields = { auth_date: String(nowSeconds), id: "42", username: "ada", ...overrides };
  return { ...fields, hash: widgetHash(fields, token) };
}

beforeAll(async () => {
  await runMigrations();
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("decideTelegramLink", () => {
  let userIds: string[] = [];

  beforeEach(() => {
    userIds = [];
  });

  afterEach(async () => {
    if (userIds.length === 0) return;
    const db = await getDb();
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    userIds = [];
  });

  it("sets a pending cookie and sends a signed-out visitor to signup", async () => {
    const result = await decideTelegramLink({
      fields: signedFields(),
      userId: null,
      botToken: token,
      appSecret,
      nowSeconds,
    });

    expect(result.redirect).toBe("/signup?telegram=1");
    expect(result.setCookie).toMatchObject({
      name: "tg_pending",
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 900,
      secure: false,
    });
    expect(readPendingTelegram(result.setCookie!.value, appSecret, nowSeconds * 1000)).toMatchObject({
      id: "42",
      username: "ada",
      authDate: nowSeconds,
    });
  });

  it("links a signed-in user and leaves one active telegram_links row", async () => {
    const db = await getDb();
    const [user] = await db
      .insert(users)
      .values({ email: `tg-link-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
      .returning({ id: users.id });
    const id = user!.id;
    userIds = [id];

    const result = await decideTelegramLink({
      fields: signedFields(),
      userId: id,
      botToken: token,
      appSecret,
      nowSeconds,
    });

    expect(result.redirect).toBe("/account?telegram=connected");
    expect(result.setCookie).toBeUndefined();
    const rows = await db
      .select()
      .from(telegramLinks)
      .where(and(eq(telegramLinks.userId, id), isNull(telegramLinks.revokedAt)));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ telegramUserId: "42", telegramUsername: "ada" });
  });

  it("reports the link as unconfigured when the bot token or signed-out app secret is missing", async () => {
    const fields = signedFields();
    await expect(
      decideTelegramLink({ fields, userId: null, botToken: undefined, appSecret, nowSeconds }),
    ).resolves.toEqual({ redirect: "/account?telegram=unconfigured" });
    await expect(
      decideTelegramLink({ fields, userId: null, botToken: token, appSecret: "", nowSeconds }),
    ).resolves.toEqual({ redirect: "/account?telegram=unconfigured" });
    await expect(
      decideTelegramLink({ fields, userId: "someone", botToken: undefined, appSecret: undefined, nowSeconds }),
    ).resolves.toEqual({ redirect: "/account?telegram=unconfigured" });
  });

  it("redirects when the telegram account or the member is already linked", async () => {
    const db = await getDb();
    const [first] = await db
      .insert(users)
      .values({ email: `tg-taken-a-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
      .returning({ id: users.id });
    const [second] = await db
      .insert(users)
      .values({ email: `tg-taken-b-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
      .returning({ id: users.id });
    const id = first!.id;
    const otherId = second!.id;
    userIds = [id, otherId];

    await decideTelegramLink({
      fields: signedFields(),
      userId: id,
      botToken: token,
      appSecret,
      nowSeconds,
    });

    const taken = await decideTelegramLink({
      fields: signedFields(),
      userId: otherId,
      botToken: token,
      appSecret,
      nowSeconds,
    });
    expect(taken).toEqual({ redirect: "/account?telegram=taken" });

    const otherFields = signedFields({ id: "99", username: "ada" });
    const already = await decideTelegramLink({
      fields: otherFields,
      userId: id,
      botToken: token,
      appSecret,
      nowSeconds,
    });
    expect(already).toEqual({ redirect: "/account?telegram=already" });

    const rows = await db.select().from(telegramLinks).where(eq(telegramLinks.userId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ telegramUserId: "42", revokedAt: null });
  });

  it("rejects a tampered username and writes no telegram_links row", async () => {
    const db = await getDb();
    const [user] = await db
      .insert(users)
      .values({ email: `tg-bad-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
      .returning({ id: users.id });
    const id = user!.id;
    userIds = [id];

    const fields = signedFields();
    const result = await decideTelegramLink({
      fields: { ...fields, username: "eve" },
      userId: id,
      botToken: token,
      appSecret,
      nowSeconds,
    });

    expect(result.redirect).toBe("/account?telegram=invalid");
    const rows = await db.select().from(telegramLinks).where(eq(telegramLinks.userId, id));
    expect(rows).toHaveLength(0);
  });
});
