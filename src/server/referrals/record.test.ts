import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb, closeDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { plans, referralFees, subscriptions, users } from "@/server/db/schema";
import { recordCollectedPayment } from "./record";

beforeAll(async () => {
  await runMigrations();
});

afterEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
});

afterAll(async () => {
  await closeDb();
});

describe("recordCollectedPayment", () => {
  it("writes an 11 dollar fee when a basic referrer is paid for a gold customer", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const db = await getDb();
    await db
      .insert(plans)
      .values({ tier: "gold", period: "monthly", amountCents: 9900, currency: "usd", active: true })
      .onConflictDoUpdate({
        target: [plans.tier, plans.period],
        set: { amountCents: 9900, currency: "usd", active: true },
      });

    const [referrer] = await db
      .insert(users)
      .values({ email: `referrer-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
      .returning();
    const [customer] = await db
      .insert(users)
      .values({
        email: `customer-${crypto.randomUUID()}@example.com`,
        passwordHash: "x",
        referredByUserId: referrer.id,
      })
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

    const fee = await recordCollectedPayment({
      paymentKey: "in_1",
      userId: customer.id,
      tier: "gold",
      period: "monthly",
      collectedCents: 9900,
      customerEmail: customer.email,
    });
    expect(fee?.amountCents).toBe(1100);
    expect(fee?.cappedTier).toBe("basic");

    const again = await recordCollectedPayment({
      paymentKey: "in_1",
      userId: customer.id,
      tier: "gold",
      period: "monthly",
      collectedCents: 9900,
      customerEmail: customer.email,
    });
    expect(again?.id).toBe(fee?.id);

    const [customerRow] = await db.select().from(users).where(eq(users.id, customer.id));
    expect(customerRow.referralCode).toMatch(/^[A-Z2-9]{8}$/);

    await db.delete(referralFees).where(eq(referralFees.referredUserId, customer.id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, referrer.id));
    await db.delete(users).where(eq(users.id, referrer.id));
    await db.delete(users).where(eq(users.id, customer.id));
  });

  it("writes nothing when the referrer is past_due but still sets the customer referral code", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const db = await getDb();
    await db
      .insert(plans)
      .values({ tier: "gold", period: "monthly", amountCents: 9900, currency: "usd", active: true })
      .onConflictDoUpdate({
        target: [plans.tier, plans.period],
        set: { amountCents: 9900, currency: "usd", active: true },
      });

    const [referrer] = await db
      .insert(users)
      .values({ email: `referrer-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
      .returning();
    const [customer] = await db
      .insert(users)
      .values({
        email: `customer-${crypto.randomUUID()}@example.com`,
        passwordHash: "x",
        referredByUserId: referrer.id,
      })
      .returning();

    const periodEnd = new Date(Date.now() + 86_400_000);
    await db.insert(subscriptions).values({
      userId: referrer.id,
      tier: "basic",
      period: "monthly",
      status: "past_due",
      provider: "mock",
      providerSubscriptionId: `mock_sub_${crypto.randomUUID()}`,
      currentPeriodEnd: periodEnd,
    });

    const fee = await recordCollectedPayment({
      paymentKey: "in_due",
      userId: customer.id,
      tier: "gold",
      period: "monthly",
      collectedCents: 9900,
      customerEmail: customer.email,
    });
    expect(fee).toBeNull();

    const [customerRow] = await db.select().from(users).where(eq(users.id, customer.id));
    expect(customerRow.referralCode).toMatch(/^[A-Z2-9]{8}$/);

    await db.delete(referralFees).where(eq(referralFees.referredUserId, customer.id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, referrer.id));
    await db.delete(users).where(eq(users.id, referrer.id));
    await db.delete(users).where(eq(users.id, customer.id));
  });
});
