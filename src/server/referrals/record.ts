import { and, eq, isNull } from "drizzle-orm";
import { getEntitledSubscription, getPlan } from "@/server/billing/subscriptions";
import { getDb } from "@/server/db";
import { referralFees, users, type BillingPeriod, type Tier } from "@/server/db/schema";
import { createReferralCode } from "./code";
import { feeForPayment, lowerTier } from "./money";

export type ReferralFeeRow = typeof referralFees.$inferSelect;

async function assignReferralCodeIfNeeded(userId: string, referralCode: string | null, period: BillingPeriod) {
  if (referralCode || period !== "monthly") return;
  const db = await getDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = createReferralCode();
    try {
      await db
        .update(users)
        .set({ referralCode: code })
        .where(and(eq(users.id, userId), isNull(users.referralCode)));
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("unique") && !message.includes("duplicate")) throw error;
    }
  }
  throw new Error("Could not assign a unique referral code");
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

  await assignReferralCodeIfNeeded(payer.id, payer.referralCode, input.period);

  const [existingFee] = await db
    .select()
    .from(referralFees)
    .where(eq(referralFees.paymentKey, input.paymentKey));
  if (existingFee) return existingFee;

  if (input.period !== "monthly") return null;
  if (!payer.referredByUserId || payer.referredByUserId === payer.id) return null;

  const referrerSub = await getEntitledSubscription(payer.referredByUserId, now);
  const eligible = referrerEligible(referrerSub, now);
  const plan = await getPlan(input.tier, "monthly");
  if (!plan?.active) return null;

  const amountCents = feeForPayment({
    collectedCents: input.collectedCents,
    customerCatalogCents: plan.amountCents,
    referrerTier: referrerSub?.tier ?? "basic",
    customerTier: input.tier,
    referrerEligible: eligible,
  });
  if (amountCents === null) return null;

  const cappedTier = lowerTier(referrerSub!.tier, input.tier);
  const [inserted] = await db
    .insert(referralFees)
    .values({
      referrerUserId: payer.referredByUserId,
      referredUserId: payer.id,
      paymentKey: input.paymentKey,
      amountCents,
      voidedCents: 0,
      referrerTier: referrerSub!.tier,
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
