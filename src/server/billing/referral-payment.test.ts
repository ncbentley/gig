import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb, closeDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { plans, referralFees, subscriptions, users } from "@/server/db/schema";
import { completeMockCheckout, reconcileSubscriptions } from "./service";

beforeAll(async () => {
  await runMigrations();
});

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
});

afterAll(async () => {
  await closeDb();
});

async function insertEligibleReferrer(db: Awaited<ReturnType<typeof getDb>>) {
  const [referrer] = await db
    .insert(users)
    .values({ email: `referrer-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
    .returning();
  const periodEnd = new Date(Date.now() + 86_400_000);
  await db.insert(subscriptions).values({
    userId: referrer.id,
    tier: "basic",
    period: "monthly",
    status: "active",
    provider: "mock",
    providerSubscriptionId: `mock_sub_${crypto.randomUUID()}`,
    currentPeriodEnd: periodEnd,
  });
  return referrer;
}

describe("referral fees from billing", () => {
  it("records a fee when completeMockCheckout collects a referred monthly payment", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const db = await getDb();
    await db
      .insert(plans)
      .values({ tier: "gold", period: "monthly", amountCents: 9900, currency: "usd", active: true })
      .onConflictDoUpdate({
        target: [plans.tier, plans.period],
        set: { amountCents: 9900, currency: "usd", active: true },
      });

    const referrer = await insertEligibleReferrer(db);
    const [customer] = await db
      .insert(users)
      .values({
        email: `customer-${crypto.randomUUID()}@example.com`,
        passwordHash: "x",
        referredByUserId: referrer.id,
      })
      .returning();

    const sub = await completeMockCheckout(customer.id, "gold", "monthly");
    const [fee] = await db.select().from(referralFees).where(eq(referralFees.referredUserId, customer.id));
    expect(fee?.amountCents).toBe(1100);
    expect(fee?.paymentKey).toBe(`mock:${sub.id}:${sub.currentPeriodEnd.toISOString()}`);

    await db.delete(referralFees).where(eq(referralFees.referredUserId, customer.id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, customer.id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, referrer.id));
    await db.delete(users).where(eq(users.id, customer.id));
    await db.delete(users).where(eq(users.id, referrer.id));
  });

  it("records a renewal fee when reconcileSubscriptions extends a mock monthly subscription", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const db = await getDb();
    await db
      .insert(plans)
      .values({ tier: "gold", period: "monthly", amountCents: 9900, currency: "usd", active: true })
      .onConflictDoUpdate({
        target: [plans.tier, plans.period],
        set: { amountCents: 9900, currency: "usd", active: true },
      });

    const referrer = await insertEligibleReferrer(db);
    const [customer] = await db
      .insert(users)
      .values({
        email: `customer-${crypto.randomUUID()}@example.com`,
        passwordHash: "x",
        referredByUserId: referrer.id,
      })
      .returning();

    const periodEnd = new Date(Date.now() - 86_400_000);
    const [sub] = await db
      .insert(subscriptions)
      .values({
        userId: customer.id,
        tier: "gold",
        period: "monthly",
        status: "active",
        provider: "mock",
        providerSubscriptionId: `mock_sub_${crypto.randomUUID()}`,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      })
      .returning();

    const periodEndIso = sub.currentPeriodEnd.toISOString();
    const now = new Date();
    await reconcileSubscriptions(now);

    const [fee] = await db.select().from(referralFees).where(eq(referralFees.referredUserId, customer.id));
    expect(fee?.amountCents).toBe(1100);
    expect(fee?.paymentKey).toBe(`mock:${sub.id}:${periodEndIso}`);

    const [renewed] = await db.select().from(subscriptions).where(eq(subscriptions.id, sub.id));
    expect(renewed.currentPeriodEnd.getTime()).toBeGreaterThan(periodEnd.getTime());

    await db.delete(referralFees).where(eq(referralFees.referredUserId, customer.id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, customer.id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, referrer.id));
    await db.delete(users).where(eq(users.id, customer.id));
    await db.delete(users).where(eq(users.id, referrer.id));
  });
});
