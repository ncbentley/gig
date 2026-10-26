import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { sessions, users } from "@/server/db/schema";
import { sha256 } from "@/server/lib/hash";
import { createTelegramSession, getCurrentUser, SESSION_COOKIE, userFromSessionToken } from "./index";

const cookieState = vi.hoisted(() => ({
  values: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieState.values.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: () => {},
    delete: () => {},
  }),
}));

beforeAll(async () => {
  await runMigrations();
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("getCurrentUser", () => {
  it("resolves a web session cookie and ignores a telegram session token", async () => {
    const db = await getDb();
    const [user] = await db
      .insert(users)
      .values({ email: `cookie-auth-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
      .returning();
    const webToken = crypto.randomUUID();
    try {
      await db.insert(sessions).values({
        id: sha256(webToken),
        userId: user!.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        source: "web",
      });
      const { token: telegramToken } = await createTelegramSession(user!.id);

      cookieState.values = new Map([[SESSION_COOKIE, webToken]]);
      expect((await getCurrentUser())?.id).toBe(user!.id);

      cookieState.values = new Map([[SESSION_COOKIE, telegramToken]]);
      expect(await getCurrentUser()).toBeNull();
      expect((await userFromSessionToken(telegramToken))?.id).toBe(user!.id);
    } finally {
      await db.delete(users).where(eq(users.id, user!.id));
    }
  });
});
