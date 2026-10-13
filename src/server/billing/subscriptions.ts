import { and, desc, eq, gt, inArray } from "drizzle-orm";
import { getDb } from "@/server/db";
import { plans, subscriptions, type BillingPeriod, type Subscription, type Tier } from "@/server/db/schema";

export const ENTITLED_STATUSES = ["active", "trialing", "past_due"] as const;

export async function getPlan(tier: Tier, period: BillingPeriod) {
  const db = await getDb();
  const [row] = await db.select().from(plans).where(and(eq(plans.tier, tier), eq(plans.period, period)));
  return row ?? null;
}

/**
 * The subscription that currently grants access. Cancelled subscriptions keep access
 * until the end of the paid period (configured rule: access_until_period_end).
 */
export async function getEntitledSubscription(userId: string, now = new Date()): Promise<Subscription | null> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.userId, userId),
        inArray(subscriptions.status, [...ENTITLED_STATUSES]),
        gt(subscriptions.currentPeriodEnd, now),
      ),
    )
    .orderBy(desc(subscriptions.currentPeriodEnd))
    .limit(1);
  return row ?? null;
}
