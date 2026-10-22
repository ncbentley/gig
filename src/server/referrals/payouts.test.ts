import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, closeDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import {
  auditLogs,
  referralAllocations,
  referralFees,
  referralPayoutAccounts,
  referralWithdrawals,
  users,
} from "@/server/db/schema";
import { decryptSecret } from "@/server/crypto/secret";
import {
  markWithdrawalSent,
  rejectWithdrawal,
  requestWithdrawal,
  savePayoutAccount,
} from "./payouts";

beforeAll(async () => {
  process.env.APP_SECRET = "payout-test-app-secret";
  await runMigrations();
});

afterAll(async () => {
  delete process.env.APP_SECRET;
  await closeDb();
});

async function createReferrer() {
  const db = await getDb();
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
  return { db, referrer, customer };
}

async function cleanupReferrer(db: Awaited<ReturnType<typeof getDb>>, referrerId: string, customerId: string) {
  const fees = await db.select({ id: referralFees.id }).from(referralFees).where(eq(referralFees.referrerUserId, referrerId));
  for (const fee of fees) {
    await db.delete(referralAllocations).where(eq(referralAllocations.feeId, fee.id));
  }
  await db.delete(referralFees).where(eq(referralFees.referrerUserId, referrerId));
  await db.delete(referralWithdrawals).where(eq(referralWithdrawals.userId, referrerId));
  await db.delete(referralPayoutAccounts).where(eq(referralPayoutAccounts.userId, referrerId));
  await db.delete(auditLogs).where(eq(auditLogs.entityId, referrerId));
  await db.delete(users).where(eq(users.id, referrerId));
  await db.delete(users).where(eq(users.id, customerId));
}

describe("referral payouts", () => {
  it("refuses a withdrawal when no payout account exists", async () => {
    const { db, referrer, customer } = await createReferrer();
    await expect(requestWithdrawal({ userId: referrer.id, amountCents: 2500 })).rejects.toThrow(
      "Add a bank account before requesting a withdrawal.",
    );
    await cleanupReferrer(db, referrer.id, customer.id);
  });

  it("validates account holder name, routing number, and account number format", async () => {
    const { db, referrer, customer } = await createReferrer();
    await expect(
      savePayoutAccount({ userId: referrer.id, accountHolderName: "A", routingNumber: "021000021", accountNumber: "123456789" }),
    ).rejects.toThrow("Enter a valid account holder name.");
    await expect(
      savePayoutAccount({ userId: referrer.id, accountHolderName: "Ada", routingNumber: "12345", accountNumber: "123456789" }),
    ).rejects.toThrow("Routing number must be 9 digits.");
    await expect(
      savePayoutAccount({ userId: referrer.id, accountHolderName: "Ada", routingNumber: "021000021", accountNumber: "12" }),
    ).rejects.toThrow("Account number must be 4 to 17 digits.");
    await cleanupReferrer(db, referrer.id, customer.id);
  });

  it("refuses a non-numeric withdrawal amount", async () => {
    const { db, referrer, customer } = await createReferrer();
    await savePayoutAccount({
      userId: referrer.id,
      accountHolderName: "Ada",
      routingNumber: "021000021",
      accountNumber: "123456789",
    });
    await expect(requestWithdrawal({ userId: referrer.id, amountCents: Number.NaN })).rejects.toThrow(
      "Enter a withdrawal amount.",
    );
    await cleanupReferrer(db, referrer.id, customer.id);
  });

  it("refuses a request under the minimum after a payout account is saved", async () => {
    const { db, referrer, customer } = await createReferrer();
    await savePayoutAccount({
      userId: referrer.id,
      accountHolderName: "Ada",
      routingNumber: "021000021",
      accountNumber: "123456789",
    });
    await expect(requestWithdrawal({ userId: referrer.id, amountCents: 1100 })).rejects.toThrow(
      "The minimum withdrawal is $25.",
    );
    await cleanupReferrer(db, referrer.id, customer.id);
  });

  it("allows one pending withdrawal and blocks a second", async () => {
    const { db, referrer, customer } = await createReferrer();
    await savePayoutAccount({
      userId: referrer.id,
      accountHolderName: "Ada",
      routingNumber: "021000021",
      accountNumber: "123456789",
    });
    await db.insert(referralFees).values([
      {
        referrerUserId: referrer.id,
        referredUserId: customer.id,
        paymentKey: `pk-${crypto.randomUUID()}`,
        amountCents: 1100,
        voidedCents: 0,
        referrerTier: "basic",
        customerTier: "basic",
        cappedTier: "basic",
        customerEmail: customer.email,
      },
      {
        referrerUserId: referrer.id,
        referredUserId: customer.id,
        paymentKey: `pk-${crypto.randomUUID()}`,
        amountCents: 2200,
        voidedCents: 0,
        referrerTier: "basic",
        customerTier: "silver",
        cappedTier: "basic",
        customerEmail: customer.email,
      },
    ]);

    await requestWithdrawal({ userId: referrer.id, amountCents: 2500 });
    await expect(requestWithdrawal({ userId: referrer.id, amountCents: 2500 })).rejects.toThrow(
      "A withdrawal is already waiting.",
    );
    await cleanupReferrer(db, referrer.id, customer.id);
  });

  it("stores encrypted routing numbers that decrypt to the original value", async () => {
    const { db, referrer, customer } = await createReferrer();
    await savePayoutAccount({
      userId: referrer.id,
      accountHolderName: "Ada",
      routingNumber: "021000021",
      accountNumber: "123456789",
    });
    const [row] = await db
      .select()
      .from(referralPayoutAccounts)
      .where(eq(referralPayoutAccounts.userId, referrer.id));
    expect(row.routingEncrypted).not.toBe("021000021");
    expect(decryptSecret(row.routingEncrypted)).toBe("021000021");
    await cleanupReferrer(db, referrer.id, customer.id);
  });

  it("audits payout account updates without bank numbers in the payload", async () => {
    const { db, referrer, customer } = await createReferrer();
    await savePayoutAccount({
      userId: referrer.id,
      accountHolderName: "Ada",
      routingNumber: "021000021",
      accountNumber: "123456789",
    });
    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, "referral.payout_account.updated"));
    const entry = rows.find((row) => (row.afterJson as { userId?: string } | null)?.userId === referrer.id);
    expect(entry).toBeDefined();
    const after = entry!.afterJson as Record<string, unknown>;
    expect(after).not.toHaveProperty("accountNumber");
    expect(after).not.toHaveProperty("routingNumber");
    await cleanupReferrer(db, referrer.id, customer.id);
  });

  it("allocates a sent withdrawal across the oldest fees first", async () => {
    const { db, referrer, customer } = await createReferrer();
    const [admin] = await db
      .insert(users)
      .values({ email: `admin-${crypto.randomUUID()}@example.com`, passwordHash: "x", role: "admin" })
      .returning();

    await savePayoutAccount({
      userId: referrer.id,
      accountHolderName: "Ada",
      routingNumber: "021000021",
      accountNumber: "123456789",
    });

    const olderAt = new Date("2024-01-01T00:00:00.000Z");
    const newerAt = new Date("2024-02-01T00:00:00.000Z");
    const [older] = await db
      .insert(referralFees)
      .values({
        referrerUserId: referrer.id,
        referredUserId: customer.id,
        paymentKey: `pk-${crypto.randomUUID()}`,
        amountCents: 1100,
        voidedCents: 0,
        referrerTier: "basic",
        customerTier: "basic",
        cappedTier: "basic",
        customerEmail: customer.email,
        createdAt: olderAt,
      })
      .returning();
    const [newer] = await db
      .insert(referralFees)
      .values({
        referrerUserId: referrer.id,
        referredUserId: customer.id,
        paymentKey: `pk-${crypto.randomUUID()}`,
        amountCents: 2200,
        voidedCents: 0,
        referrerTier: "basic",
        customerTier: "silver",
        cappedTier: "basic",
        customerEmail: customer.email,
        createdAt: newerAt,
      })
      .returning();

    await requestWithdrawal({ userId: referrer.id, amountCents: 2500 });
    const [pending] = await db
      .select()
      .from(referralWithdrawals)
      .where(eq(referralWithdrawals.userId, referrer.id));

    const sent = await markWithdrawalSent({ withdrawalId: pending.id, adminId: admin.id });
    expect(sent.allocations).toEqual([
      { feeId: older.id, cents: 1100 },
      { feeId: newer.id, cents: 1400 },
    ]);

    await db.delete(users).where(eq(users.id, admin.id));
    await cleanupReferrer(db, referrer.id, customer.id);
  });

  it("audits mark-sent without bank numbers in the payload", async () => {
    const { db, referrer, customer } = await createReferrer();
    const [admin] = await db
      .insert(users)
      .values({ email: `admin-${crypto.randomUUID()}@example.com`, passwordHash: "x", role: "admin" })
      .returning();

    await savePayoutAccount({
      userId: referrer.id,
      accountHolderName: "Ada",
      routingNumber: "021000021",
      accountNumber: "123456789",
    });
    await db.insert(referralFees).values({
      referrerUserId: referrer.id,
      referredUserId: customer.id,
      paymentKey: `pk-${crypto.randomUUID()}`,
      amountCents: 3300,
      voidedCents: 0,
      referrerTier: "basic",
      customerTier: "gold",
      cappedTier: "basic",
      customerEmail: customer.email,
    });
    await requestWithdrawal({ userId: referrer.id, amountCents: 2500 });
    const [pending] = await db
      .select()
      .from(referralWithdrawals)
      .where(eq(referralWithdrawals.userId, referrer.id));
    await markWithdrawalSent({ withdrawalId: pending.id, adminId: admin.id });

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, "referral.withdrawal.sent"));
    const entry = rows.find(
      (row) => (row.afterJson as { withdrawalId?: string } | null)?.withdrawalId === pending.id,
    );
    expect(entry).toBeDefined();
    const after = entry!.afterJson as Record<string, unknown>;
    expect(after).toMatchObject({ withdrawalId: pending.id, amountCents: 2500 });
    expect(after).not.toHaveProperty("accountNumber");
    expect(after).not.toHaveProperty("routingNumber");

    await db.delete(users).where(eq(users.id, admin.id));
    await cleanupReferrer(db, referrer.id, customer.id);
  });

  it("rejects a pending withdrawal and writes an audit entry", async () => {
    const { db, referrer, customer } = await createReferrer();
    const [admin] = await db
      .insert(users)
      .values({ email: `admin-${crypto.randomUUID()}@example.com`, passwordHash: "x", role: "admin" })
      .returning();
    const [otherReferrer] = await db
      .insert(users)
      .values({ email: `other-${crypto.randomUUID()}@example.com`, passwordHash: "x" })
      .returning();
    const [otherCustomer] = await db
      .insert(users)
      .values({
        email: `other-cust-${crypto.randomUUID()}@example.com`,
        passwordHash: "x",
        referredByUserId: otherReferrer.id,
      })
      .returning();

    const [pending] = await db
      .insert(referralWithdrawals)
      .values({ userId: otherReferrer.id, amountCents: 2500, status: "pending" })
      .returning();

    await rejectWithdrawal({ withdrawalId: pending.id, adminId: admin.id });

    const [row] = await db.select().from(referralWithdrawals).where(eq(referralWithdrawals.id, pending.id));
    expect(row.status).toBe("rejected");

    const rows = await db.select().from(auditLogs).where(eq(auditLogs.action, "referral.withdrawal.rejected"));
    const entry = rows.find((row) => row.entityId === pending.id);
    expect(entry).toBeDefined();
    const after = entry!.afterJson as Record<string, unknown>;
    expect(after).not.toHaveProperty("accountNumber");
    expect(after).not.toHaveProperty("routingNumber");

    await db.delete(referralWithdrawals).where(eq(referralWithdrawals.userId, otherReferrer.id));
    await db.delete(users).where(eq(users.id, admin.id));
    await db.delete(users).where(eq(users.id, otherReferrer.id));
    await db.delete(users).where(eq(users.id, otherCustomer.id));
    await cleanupReferrer(db, referrer.id, customer.id);
  });
});
