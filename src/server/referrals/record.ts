import { and, eq, isNull, sql } from "drizzle-orm";
import { getEntitledSubscription, getPlan } from "@/server/billing/subscriptions";
import { getDb } from "@/server/db";
import {
  referralAdjustments,
  referralAllocations,
  referralFees,
  referralWithdrawals,
  users,
  type BillingPeriod,
  type Tier,
} from "@/server/db/schema";
import { getComplimentaryTier } from "@/server/entitlements/grants";
import { ensureReferralCode } from "./assign";
import { feeForPayment, lowerTier, requestableBalance, reverseFee } from "./money";

export type ReferralFeeRow = typeof referralFees.$inferSelect;

function higherTier(a: Tier, b: Tier): Tier {
  return lowerTier(a, b) === a ? b : a;
}

function referrerEligible(
  sub: Awaited<ReturnType<typeof getEntitledSubscription>>,
  now: Date,
): sub is NonNullable<typeof sub> {
  return (
    sub !== null &&
    sub.period === "monthly" &&
    sub.status === "active" &&
    sub.currentPeriodEnd.getTime() > now.getTime()
  );
}

export async function recordCollectedPayment(input: {
  paymentKey: string;
  userId: string;
  tier: Tier;
  period: BillingPeriod;
  collectedCents: number;
  customerEmail: string;
}): Promise<ReferralFeeRow | null> {
  const db = await getDb();
  const now = new Date();

  const [payer] = await db.select().from(users).where(eq(users.id, input.userId));
  if (!payer) return null;

  if (input.period === "monthly") await ensureReferralCode(payer.id);

  if (input.period === "monthly") {
    await db
      .update(users)
      .set({ referralLockedAt: now })
      .where(and(eq(users.id, payer.id), isNull(users.referralLockedAt)));
  }

  const [existingFee] = await db
    .select()
    .from(referralFees)
    .where(eq(referralFees.paymentKey, input.paymentKey));
  if (existingFee) return existingFee;

  if (input.period !== "monthly") return null;
  if (!payer.referredByUserId || payer.referredByUserId === payer.id) return null;

  const referrerSub = await getEntitledSubscription(payer.referredByUserId, now);
  const paidTier = referrerEligible(referrerSub, now) ? referrerSub.tier : null;
  const grant = await getComplimentaryTier(payer.referredByUserId);
  const referrerTier = paidTier && grant ? higherTier(paidTier, grant) : paidTier ?? grant;
  const plan = await getPlan(input.tier, "monthly");
  if (!plan?.active) return null;

  const amountCents = feeForPayment({
    collectedCents: input.collectedCents,
    customerCatalogCents: plan.amountCents,
    referrerTier: referrerTier ?? "basic",
    customerTier: input.tier,
    referrerEligible: referrerTier !== null,
  });
  if (amountCents === null || !referrerTier) return null;

  const cappedTier = lowerTier(referrerTier, input.tier);
  const [inserted] = await db
    .insert(referralFees)
    .values({
      referrerUserId: payer.referredByUserId,
      referredUserId: payer.id,
      paymentKey: input.paymentKey,
      amountCents,
      voidedCents: 0,
      referrerTier,
      customerTier: input.tier,
      cappedTier,
      customerEmail: input.customerEmail,
    })
    .onConflictDoNothing({ target: referralFees.paymentKey })
    .returning();

  if (inserted) return inserted;

  const [row] = await db.select().from(referralFees).where(eq(referralFees.paymentKey, input.paymentKey));
  return row ?? null;
}

export async function reverseCollectedPayment(input: { paymentKey: string; externalId: string }) {
  const db = await getDb();

  const [existingAdjustment] = await db
    .select({ id: referralAdjustments.id })
    .from(referralAdjustments)
    .where(eq(referralAdjustments.externalId, input.externalId));
  if (existingAdjustment) return;

  const [fee] = await db.select().from(referralFees).where(eq(referralFees.paymentKey, input.paymentKey));
  if (!fee) return;

  const allocatedRows = await db
    .select({ amountCents: referralAllocations.amountCents })
    .from(referralAllocations)
    .innerJoin(referralWithdrawals, eq(referralAllocations.withdrawalId, referralWithdrawals.id))
    .where(and(eq(referralAllocations.feeId, fee.id), eq(referralWithdrawals.status, "sent")));
  const allocatedCents = allocatedRows.reduce((sum, row) => sum + row.amountCents, 0);

  const { voidedCents, clawbackCents } = reverseFee({
    amountCents: fee.amountCents,
    voidedCents: fee.voidedCents,
    allocatedCents,
  });
  const voidedDelta = voidedCents - fee.voidedCents;

  const [feeAdjustmentsSum] = await db
    .select({ total: sql<number>`coalesce(sum(${referralAdjustments.amountCents}), 0)` })
    .from(referralAdjustments)
    .where(eq(referralAdjustments.feeId, fee.id));
  const priorAdjustmentsCents = Number(feeAdjustmentsSum?.total ?? 0);
  if (voidedDelta === 0 && priorAdjustmentsCents <= -clawbackCents) return;

  const [pendingWithdrawal] = await db
    .select()
    .from(referralWithdrawals)
    .where(and(eq(referralWithdrawals.userId, fee.referrerUserId), eq(referralWithdrawals.status, "pending")));

  let rejectPendingWithdrawalId: string | null = null;
  if (pendingWithdrawal) {
    const referrerFees = await db
      .select({
        id: referralFees.id,
        amountCents: referralFees.amountCents,
        voidedCents: referralFees.voidedCents,
      })
      .from(referralFees)
      .where(eq(referralFees.referrerUserId, fee.referrerUserId));

    const [adjustmentsSum] = await db
      .select({ total: sql<number>`coalesce(sum(${referralAdjustments.amountCents}), 0)` })
      .from(referralAdjustments)
      .innerJoin(referralFees, eq(referralAdjustments.feeId, referralFees.id))
      .where(eq(referralFees.referrerUserId, fee.referrerUserId));

    const [sentSum] = await db
      .select({ total: sql<number>`coalesce(sum(${referralWithdrawals.amountCents}), 0)` })
      .from(referralWithdrawals)
      .where(and(eq(referralWithdrawals.userId, fee.referrerUserId), eq(referralWithdrawals.status, "sent")));

    const feesAfterVoid = referrerFees.map((row) =>
      row.id === fee.id ? { amountCents: row.amountCents, voidedCents } : row,
    );

    const balance = requestableBalance({
      fees: feesAfterVoid,
      adjustmentsCents: Number(adjustmentsSum?.total ?? 0) - clawbackCents,
      sentCents: Number(sentSum?.total ?? 0),
      pendingCents: 0,
    });

    if (balance < pendingWithdrawal.amountCents) {
      rejectPendingWithdrawalId = pendingWithdrawal.id;
    }
  }

  await db.transaction(async (tx) => {
    await tx.update(referralFees).set({ voidedCents }).where(eq(referralFees.id, fee.id));
    await tx.insert(referralAdjustments).values({
      feeId: fee.id,
      externalId: input.externalId,
      amountCents: -clawbackCents,
      voidedCents: voidedDelta,
    });
    if (rejectPendingWithdrawalId) {
      await tx
        .update(referralWithdrawals)
        .set({ status: "rejected", resolvedAt: new Date(), resolvedByUserId: null })
        .where(eq(referralWithdrawals.id, rejectPendingWithdrawalId));
    }
  });
}

export async function restoreReversedPayment(input: { externalId: string }) {
  const db = await getDb();

  const [adjustment] = await db
    .select()
    .from(referralAdjustments)
    .where(eq(referralAdjustments.externalId, input.externalId));
  if (!adjustment) return;

  const [fee] = await db.select().from(referralFees).where(eq(referralFees.id, adjustment.feeId));
  if (!fee) {
    await db.delete(referralAdjustments).where(eq(referralAdjustments.id, adjustment.id));
    return;
  }

  const voidedCents = Math.max(0, fee.voidedCents - adjustment.voidedCents);
  await db.transaction(async (tx) => {
    await tx.update(referralFees).set({ voidedCents }).where(eq(referralFees.id, fee.id));
    await tx.delete(referralAdjustments).where(eq(referralAdjustments.id, adjustment.id));
  });
}
