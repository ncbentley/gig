import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTelegramSession, SESSION_COOKIE } from "@/server/auth";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { sessions, subscriptions, users } from "@/server/db/schema";
import { sha256 } from "@/server/lib/hash";
import { GET } from "./route";

const headerState = vi.hoisted(() => ({
  headers: new Headers(),
}));

const cookieState = vi.hoisted(() => ({
  values: new Map<string, string>(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = cookieState.values.get(name);
      return value === undefined ? undefined : { name, value };
    },
  }),
  headers: async () => headerState.headers,
}));

async function createEntitledMember(tier: "basic" | "gold") {
  const db = await getDb();
  const [user] = await db
    .insert(users)
    .values({ email: `entitlements-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
    .returning();
  await db.insert(subscriptions).values({
    userId: user!.id,
    tier,
    period: "monthly",
    status: "active",
    provider: "mock",
    providerSubscriptionId: `mock_sub_${crypto.randomUUID()}`,
    currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
  });
  return user!;
}

beforeAll(async () => {
  await runMigrations();
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("GET /api/v1/me/entitlements", () => {
  it("returns the telegram member tier when Authorization is a bearer and the website cookie is absent", async () => {
    const member = await createEntitledMember("basic");
    try {
      const { token } = await createTelegramSession(member.id);
      headerState.headers = new Headers({ authorization: `Bearer ${token}` });
      cookieState.values = new Map();

      const res = await GET();

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.tier).toBe("basic");
      expect(body.data.subscription).toMatchObject({ tier: "basic", status: "active" });
      expect(body.data.isAdmin).toBe(false);
    } finally {
      const db = await getDb();
      await db.delete(users).where(eq(users.id, member.id));
    }
  });

  it("rejects a dead bearer and does not fall through to a different user's website session", async () => {
    const cookieUser = await createEntitledMember("gold");
    try {
      const cookieToken = crypto.randomUUID();
      const db = await getDb();
      await db.insert(sessions).values({
        id: sha256(cookieToken),
        userId: cookieUser.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        source: "web",
      });
      headerState.headers = new Headers({ authorization: "Bearer dead" });
      cookieState.values = new Map([[SESSION_COOKIE, cookieToken]]);

      const res = await GET();

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toEqual({ error: { code: "unauthenticated", message: "Sign in to use the API." } });
      expect(JSON.stringify(body)).not.toContain(cookieUser.id);
    } finally {
      const db = await getDb();
      await db.delete(users).where(eq(users.id, cookieUser.id));
    }
  });

  it("returns 401 when there is no Authorization header and no session cookie", async () => {
    headerState.headers = new Headers();
    cookieState.values = new Map();

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: { code: "unauthenticated", message: "Sign in to use the API." } });
  });
});
