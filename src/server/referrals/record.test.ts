import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { getDb, closeDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import {
  plans,
  referralAdjustments,
  referralAllocations,
  referralFees,
  referralWithdrawals,
  subscriptions,
  users,
} from "@/server/db/schema";
import { recordCollectedPayment, reverseCollectedPayment, restoreReversedPayment } from "./record";

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

describe("reverseCollectedPayment", () => {
  it("voids a fee that has not been paid out", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const db = await getDb();
    await db
      .insert(plans)
      .values({ tier: "basic", period: "monthly", amountCents: 3300, currency: "usd", active: true })
      .onConflictDoUpdate({
        target: [plans.tier, plans.period],
        set: { amountCents: 3300, currency: "usd", active: true },
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

    await recordCollectedPayment({
      paymentKey: "in_void",
      userId: customer.id,
      tier: "basic",
      period: "monthly",
      collectedCents: 3300,
      customerEmail: customer.email,
    });

    await reverseCollectedPayment({ paymentKey: "in_void", externalId: "re_1" });

    const [fee] = await db.select().from(referralFees).where(eq(referralFees.paymentKey, "in_void"));
    expect(fee?.voidedCents).toBe(1100);

    await reverseCollectedPayment({ paymentKey: "in_void", externalId: "re_1" });
    const [feeAgain] = await db.select().from(referralFees).where(eq(referralFees.paymentKey, "in_void"));
    expect(feeAgain?.voidedCents).toBe(1100);

    await db.delete(referralAdjustments).where(eq(referralAdjustments.feeId, fee!.id));
    await db.delete(referralFees).where(eq(referralFees.referredUserId, customer.id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, referrer.id));
    await db.delete(users).where(eq(users.id, referrer.id));
    await db.delete(users).where(eq(users.id, customer.id));
  });

  it("claws back the allocated part and cancels a pending withdrawal that no longer fits", async () => {
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
      tier: "gold",
      period: "monthly",
      status: "active",
      provider: "mock",
      providerSubscriptionId: `mock_sub_${crypto.randomUUID()}`,
      currentPeriodEnd: periodEnd,
    });

    const fee = await recordCollectedPayment({
      paymentKey: "in_claw",
      userId: customer.id,
      tier: "gold",
      period: "monthly",
      collectedCents: 9900,
      customerEmail: customer.email,
    });
    expect(fee?.amountCents).toBe(3300);

    const [sentWithdrawal] = await db
      .insert(referralWithdrawals)
      .values({ userId: referrer.id, amountCents: 2500, status: "sent", resolvedAt: new Date() })
      .returning();
    await db.insert(referralAllocations).values({
      withdrawalId: sentWithdrawal.id,
      feeId: fee!.id,
      amountCents: 2500,
    });
    const [pendingWithdrawal] = await db
      .insert(referralWithdrawals)
      .values({ userId: referrer.id, amountCents: 800, status: "pending" })
      .returning();

    await reverseCollectedPayment({ paymentKey: "in_claw", externalId: "re_claw" });

    const [feeRow] = await db.select().from(referralFees).where(eq(referralFees.paymentKey, "in_claw"));
    expect(feeRow?.voidedCents).toBe(800);

    const [adjustment] = await db
      .select()
      .from(referralAdjustments)
      .where(eq(referralAdjustments.externalId, "re_claw"));
    expect(adjustment?.amountCents).toBe(-2500);

    const [pendingRow] = await db
      .select()
      .from(referralWithdrawals)
      .where(eq(referralWithdrawals.id, pendingWithdrawal.id));
    expect(pendingRow?.status).toBe("rejected");

    await db.delete(referralAllocations).where(eq(referralAllocations.feeId, fee!.id));
    await db.delete(referralAdjustments).where(eq(referralAdjustments.feeId, fee!.id));
    await db.delete(referralWithdrawals).where(eq(referralWithdrawals.userId, referrer.id));
    await db.delete(referralFees).where(eq(referralFees.referredUserId, customer.id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, referrer.id));
    await db.delete(users).where(eq(users.id, referrer.id));
    await db.delete(users).where(eq(users.id, customer.id));
  });

  it("does not claw back twice when a second refund uses a different external id", async () => {
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
      tier: "gold",
      period: "monthly",
      status: "active",
      provider: "mock",
      providerSubscriptionId: `mock_sub_${crypto.randomUUID()}`,
      currentPeriodEnd: periodEnd,
    });

    const fee = await recordCollectedPayment({
      paymentKey: "in_twice",
      userId: customer.id,
      tier: "gold",
      period: "monthly",
      collectedCents: 9900,
      customerEmail: customer.email,
    });
    expect(fee?.amountCents).toBe(3300);

    const [sentWithdrawal] = await db
      .insert(referralWithdrawals)
      .values({ userId: referrer.id, amountCents: 2500, status: "sent", resolvedAt: new Date() })
      .returning();
    await db.insert(referralAllocations).values({
      withdrawalId: sentWithdrawal.id,
      feeId: fee!.id,
      amountCents: 2500,
    });

    await reverseCollectedPayment({ paymentKey: "in_twice", externalId: "re_1" });
    await reverseCollectedPayment({ paymentKey: "in_twice", externalId: "re_2" });

    const [feeRow] = await db.select().from(referralFees).where(eq(referralFees.paymentKey, "in_twice"));
    expect(feeRow?.voidedCents).toBe(800);

    const adjustments = await db
      .select()
      .from(referralAdjustments)
      .where(eq(referralAdjustments.feeId, fee!.id));
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]?.amountCents).toBe(-2500);

    await db.delete(referralAllocations).where(eq(referralAllocations.feeId, fee!.id));
    await db.delete(referralAdjustments).where(eq(referralAdjustments.feeId, fee!.id));
    await db.delete(referralWithdrawals).where(eq(referralWithdrawals.userId, referrer.id));
    await db.delete(referralFees).where(eq(referralFees.referredUserId, customer.id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, referrer.id));
    await db.delete(users).where(eq(users.id, referrer.id));
    await db.delete(users).where(eq(users.id, customer.id));
  });
});

describe("restoreReversedPayment", () => {
  it("restores a won dispute once", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const db = await getDb();
    await db
      .insert(plans)
      .values({ tier: "basic", period: "monthly", amountCents: 3300, currency: "usd", active: true })
      .onConflictDoUpdate({
        target: [plans.tier, plans.period],
        set: { amountCents: 3300, currency: "usd", active: true },
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
      paymentKey: "in_restore",
      userId: customer.id,
      tier: "basic",
      period: "monthly",
      collectedCents: 3300,
      customerEmail: customer.email,
    });

    await reverseCollectedPayment({ paymentKey: "in_restore", externalId: "dp_1" });

    await restoreReversedPayment({ externalId: "dp_1" });

    const [feeRow] = await db.select().from(referralFees).where(eq(referralFees.paymentKey, "in_restore"));
    expect(feeRow?.voidedCents).toBe(0);

    const adjustments = await db
      .select()
      .from(referralAdjustments)
      .where(eq(referralAdjustments.externalId, "dp_1"));
    expect(adjustments).toHaveLength(0);

    await restoreReversedPayment({ externalId: "dp_1" });

    const [feeAfterSecond] = await db.select().from(referralFees).where(eq(referralFees.paymentKey, "in_restore"));
    expect(feeAfterSecond?.voidedCents).toBe(0);

    await db.delete(referralFees).where(eq(referralFees.id, fee!.id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, referrer.id));
    await db.delete(users).where(eq(users.id, referrer.id));
    await db.delete(users).where(eq(users.id, customer.id));
  });
});
