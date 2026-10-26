import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { userFromSessionToken } from "@/server/auth";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { sessions, subscriptions, users } from "@/server/db/schema";
import { sha256 } from "@/server/lib/hash";
import { linkTelegram } from "@/server/telegram/links";
import { POST } from "./route";

const BOT = "123456:TEST";
const URL = "http://localhost/api/v1/telegram/session";
const ORIGINAL_TOKEN = process.env.TELEGRAM_LINK_BOT_TOKEN;

let telegramSeq = 800_000_000_000_000;

function compareKeys(a: string, b: string) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function miniAppHash(pairs: [string, string][], botToken: string) {
  const sorted = [...pairs].sort(([a], [b]) => compareKeys(a, b));
  const check = sorted.map(([key, value]) => `${key}=${value}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  return createHmac("sha256", secret).update(check).digest("hex");
}

function nextTelegramId() {
  telegramSeq += 1;
  return String(telegramSeq);
}

function signedInitData(telegramId: string, username = "ada") {
  const authDate = String(Math.floor(Date.now() / 1000));
  const user = JSON.stringify({ id: Number(telegramId), username });
  const pairs: [string, string][] = [
    ["auth_date", authDate],
    ["query_id", "AAE"],
    ["user", user],
  ];
  return `auth_date=${authDate}&query_id=AAE&user=${encodeURIComponent(user)}&hash=${miniAppHash(pairs, BOT)}`;
}

function post(body: unknown) {
  return new Request(URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postRaw(raw: string) {
  return new Request(URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw,
  });
}

async function telegramSessionIds() {
  const db = await getDb();
  const rows = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.source, "telegram"));
  return rows.map((row) => row.id).sort();
}

async function userIds() {
  const db = await getDb();
  const rows = await db.select({ id: users.id }).from(users);
  return rows.map((row) => row.id).sort();
}

async function createLinkedBasicMember(telegramUserId: string) {
  const db = await getDb();
  const email = `tg-session-${crypto.randomUUID()}@example.com`;
  const [user] = await db.insert(users).values({ email, passwordHash: "x" }).returning();
  await db.insert(subscriptions).values({
    userId: user!.id,
    tier: "basic",
    period: "monthly",
    status: "active",
    provider: "mock",
    providerSubscriptionId: `mock_sub_${crypto.randomUUID()}`,
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
  });
  await linkTelegram({
    userId: user!.id,
    telegramUserId,
    username: "ada",
    authDate: new Date(),
  });
  return { user: user!, email };
}

beforeAll(async () => {
  process.env.TELEGRAM_LINK_BOT_TOKEN = BOT;
  await runMigrations();
}, 60_000);

afterAll(async () => {
  if (ORIGINAL_TOKEN === undefined) delete process.env.TELEGRAM_LINK_BOT_TOKEN;
  else process.env.TELEGRAM_LINK_BOT_TOKEN = ORIGINAL_TOKEN;
  await closeDb();
});

beforeEach(() => {
  process.env.TELEGRAM_LINK_BOT_TOKEN = BOT;
});

describe("POST /api/v1/telegram/session", () => {
  it("rejects a missing init_data, a non-string init_data, and a non-JSON body", async () => {
    const missing = await POST(post({}));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: { code: "invalid_body", message: "init_data is required." } });

    const numeric = await POST(post({ init_data: 42 }));
    expect(numeric.status).toBe(400);
    expect(await numeric.json()).toEqual({ error: { code: "invalid_body", message: "init_data is required." } });

    const notJson = await POST(postRaw("not-json"));
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toEqual({ error: { code: "invalid_body", message: "init_data is required." } });
  });

  it("returns 503 when the bot token is missing or empty, after the body is valid", async () => {
    const previous = process.env.TELEGRAM_LINK_BOT_TOKEN;
    try {
      delete process.env.TELEGRAM_LINK_BOT_TOKEN;
      const invalidBody = await POST(post({}));
      expect(invalidBody.status).toBe(400);
      expect(await invalidBody.json()).toEqual({ error: { code: "invalid_body", message: "init_data is required." } });

      const missing = await POST(post({ init_data: signedInitData(nextTelegramId()) }));
      expect(missing.status).toBe(503);
      expect(await missing.json()).toEqual({
        error: { code: "telegram_unconfigured", message: "Telegram sign-in is not configured." },
      });

      process.env.TELEGRAM_LINK_BOT_TOKEN = "";
      const empty = await POST(post({ init_data: signedInitData(nextTelegramId()) }));
      expect(empty.status).toBe(503);
      expect(await empty.json()).toEqual({
        error: { code: "telegram_unconfigured", message: "Telegram sign-in is not configured." },
      });
    } finally {
      if (previous === undefined) delete process.env.TELEGRAM_LINK_BOT_TOKEN;
      else process.env.TELEGRAM_LINK_BOT_TOKEN = previous;
    }
  });

  it("rejects a bad hash and an empty init_data string", async () => {
    const bad = await POST(post({ init_data: `auth_date=1&user=${encodeURIComponent('{"id":42}')}&hash=${"00".repeat(32)}` }));
    expect(bad.status).toBe(401);
    expect(await bad.json()).toEqual({
      error: { code: "invalid_init_data", message: "Telegram launch proof was rejected." },
    });

    const empty = await POST(post({ init_data: "" }));
    expect(empty.status).toBe(401);
    expect(await empty.json()).toEqual({
      error: { code: "invalid_init_data", message: "Telegram launch proof was rejected." },
    });
  });

  it("returns linked false and creates no session when the telegram id has no active link", async () => {
    const sessionsBefore = await telegramSessionIds();
    const usersBefore = await userIds();
    const res = await POST(post({ init_data: signedInitData(nextTelegramId()) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { linked: false } });
    expect(await telegramSessionIds()).toEqual(sessionsBefore);
    expect(await userIds()).toEqual(usersBefore);
  });

  it("returns a member session and basic entitlements for an active link", async () => {
    const telegramUserId = nextTelegramId();
    const { user, email } = await createLinkedBasicMember(telegramUserId);
    try {
      const res = await POST(post({ init_data: signedInitData(telegramUserId) }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({
        data: {
          linked: true,
          session_token: expect.any(String),
          expires_at: expect.any(String),
          user: { id: user.id },
          entitlements: {
            tier: "basic",
            historyDays: 7,
            features: ["signals.basic_result", "signals.core", "signals.levels"],
          },
        },
      });

      const db = await getDb();
      const [row] = await db.select().from(sessions).where(eq(sessions.id, sha256(body.data.session_token)));
      expect(row?.source).toBe("telegram");
      expect(row?.userId).toBe(user.id);
      expect(body.data.expires_at).toBe(row!.expiresAt.toISOString());

      const sessionUser = await userFromSessionToken(body.data.session_token);
      expect(sessionUser?.id).toBe(user.id);

      const text = JSON.stringify(body);
      expect(text).not.toContain(email);
      expect(text).not.toContain("isAdmin");
      expect(text).not.toContain("subscription");
      expect(text).not.toContain(telegramUserId);
    } finally {
      const db = await getDb();
      await db.delete(users).where(eq(users.id, user.id));
    }
  });

  it("issues a second session for the same init_data without revoking the first", async () => {
    const telegramUserId = nextTelegramId();
    const { user } = await createLinkedBasicMember(telegramUserId);
    try {
      const initData = signedInitData(telegramUserId);
      const first = await POST(post({ init_data: initData }));
      const second = await POST(post({ init_data: initData }));
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const firstBody = await first.json();
      const secondBody = await second.json();
      expect(firstBody.data.linked).toBe(true);
      expect(secondBody.data.linked).toBe(true);
      expect(secondBody.data.session_token).not.toBe(firstBody.data.session_token);
      expect((await userFromSessionToken(firstBody.data.session_token))?.id).toBe(user.id);
      expect((await userFromSessionToken(secondBody.data.session_token))?.id).toBe(user.id);

      const db = await getDb();
      const rows = await db
        .select()
        .from(sessions)
        .where(and(eq(sessions.userId, user.id), eq(sessions.source, "telegram")));
      expect(rows).toHaveLength(2);
    } finally {
      const db = await getDb();
      await db.delete(users).where(eq(users.id, user.id));
    }
  });
});
