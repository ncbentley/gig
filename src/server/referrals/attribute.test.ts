import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, closeDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { plans, users } from "@/server/db/schema";
import { referrerIdForCode, setReferrer } from "./attribute";
import { recordCollectedPayment } from "./record";

beforeAll(async () => {
  await runMigrations();
});

afterAll(async () => {
  await closeDb();
});

describe("referrerIdForCode", () => {
  it("stores a matching code and ignores an unknown one", async () => {
    const db = await getDb();
    const [referrer] = await db
      .insert(users)
      .values({
        email: `referrer-${crypto.randomUUID()}@example.com`,
        passwordHash: "x",
        referralCode: "ABCDEFGH",
      })
      .returning();

    expect(await referrerIdForCode(referrer.referralCode!)).toBe(referrer.id);
    expect(await referrerIdForCode("NOPE9999")).toBeNull();

    await db.delete(users).where(eq(users.id, referrer.id));
  });
});

describe("setReferrer", () => {
  it("replaces the referrer until the first monthly payment locks it", async () => {
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
      .values({
        email: `referrer-${crypto.randomUUID()}@example.com`,
        passwordHash: "x",
        referralCode: "HJKLMNPQ",
      })
      .returning();
    const [other] = await db
      .insert(users)
      .values({
        email: `other-${crypto.randomUUID()}@example.com`,
        passwordHash: "x",
        referralCode: "RSTUVWXY",
      })
      .returning();
    const [customer] = await db
      .insert(users)
      .values({ email: `customer-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
      .returning();

    await setReferrer({ userId: customer.id, code: referrer.referralCode! });
    await setReferrer({ userId: customer.id, code: other.referralCode! });
    const [row] = await db.select().from(users).where(eq(users.id, customer.id));
    expect(row.referredByUserId).toBe(other.id);

    await recordCollectedPayment({
      paymentKey: "lock",
      userId: customer.id,
      tier: "basic",
      period: "monthly",
      collectedCents: 3300,
      customerEmail: customer.email,
    });

    const [locked] = await db.select().from(users).where(eq(users.id, customer.id));
    expect(locked.referralLockedAt).not.toBeNull();

    await expect(setReferrer({ userId: customer.id, code: referrer.referralCode! })).rejects.toThrow(
      "The referrer is already locked.",
    );

    await db.delete(users).where(eq(users.id, customer.id));
    await db.delete(users).where(eq(users.id, referrer.id));
    await db.delete(users).where(eq(users.id, other.id));
  });

  it("refuses a member's own code", async () => {
    const db = await getDb();
    const [referrer] = await db
      .insert(users)
      .values({
        email: `referrer-${crypto.randomUUID()}@example.com`,
        passwordHash: "x",
        referralCode: "23456789",
      })
      .returning();

    await expect(setReferrer({ userId: referrer.id, code: referrer.referralCode! })).rejects.toThrow(
      "Enter a different member's code.",
    );

    await db.delete(users).where(eq(users.id, referrer.id));
  });

  it("rejects an unknown code", async () => {
    const db = await getDb();
    const [customer] = await db
      .insert(users)
      .values({ email: `customer-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
      .returning();

    await expect(setReferrer({ userId: customer.id, code: "ZZZZZZZZ" })).rejects.toThrow(
      "That referral code was not found.",
    );

    await db.delete(users).where(eq(users.id, customer.id));
  });
});
