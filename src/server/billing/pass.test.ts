import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb, closeDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { accessPasses, users } from "@/server/db/schema";
import { installAnalyticsSender } from "@/server/analytics/posthog";
import { PASS_MS } from "@/server/entitlements/trial";
import { PASS_PRICE_CENTS, activePass, completeMockPass, refundPass } from "./pass";

beforeAll(async () => {
  await runMigrations();
});

afterEach(() => {
  installAnalyticsSender(null);
  delete process.env.POSTHOG_API_KEY;
  delete process.env.STRIPE_SECRET_KEY;
});

afterAll(async () => {
  await closeDb();
});

describe("completeMockPass", () => {
  it("opens a pass for exactly 10 days at $10 and refuses a second active pass", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const events: { distinctId: string; event: string; properties: Record<string, unknown> }[] = [];
    installAnalyticsSender({
      capture(event) {
        events.push(event);
      },
      alias() {},
      setPerson() {},
    });
    process.env.POSTHOG_API_KEY = "phc_test";

    const db = await getDb();
    const [user] = await db.insert(users).values({ email: `pass-${crypto.randomUUID()}@example.com`, passwordHash: "x" }).returning();
    const now = new Date("2026-10-01T12:00:00.000Z");

    const pass = await completeMockPass(user.id, now);
    expect(pass.amountCents).toBe(PASS_PRICE_CENTS);
    expect(pass.amountCents).toBe(1000);
    expect(pass.endsAt.getTime() - pass.startsAt.getTime()).toBe(PASS_MS);

    const active = await activePass(user.id, now);
    expect(active?.id).toBe(pass.id);

    await expect(completeMockPass(user.id, now)).rejects.toThrow("A full-access pass is already active.");

    const purchased = events.find((event) => event.event === "pass_purchased");
    expect(purchased).toMatchObject({
      distinctId: user.id,
      properties: { amountCents: 1000, provider: "mock" },
    });

    await db.delete(accessPasses).where(eq(accessPasses.userId, user.id));
    await db.delete(users).where(eq(users.id, user.id));
  });
});

describe("refundPass", () => {
  it("sets status to refunded", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const db = await getDb();
    const [user] = await db.insert(users).values({ email: `refund-${crypto.randomUUID()}@example.com`, passwordHash: "x" }).returning();
    const now = new Date("2026-10-01T12:00:00.000Z");
    const pass = await completeMockPass(user.id, now);

    await refundPass(pass.providerPaymentId);

    const [row] = await db.select().from(accessPasses).where(eq(accessPasses.id, pass.id));
    expect(row?.status).toBe("refunded");

    await db.delete(accessPasses).where(eq(accessPasses.userId, user.id));
    await db.delete(users).where(eq(users.id, user.id));
  });
});
