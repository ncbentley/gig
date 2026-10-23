import { and, desc, eq, gt, inArray, lte } from "drizzle-orm";
import type Stripe from "stripe";
import { recordAudit, SYSTEM, type Actor } from "@/server/audit";
import { appUrl } from "@/server/auth";
import { getDb } from "@/server/db";
import { plans, subscriptions, users, type BillingPeriod, type Subscription, type Tier } from "@/server/db/schema";
import { trackEvent, trackRevenue } from "@/server/analytics";
import { billingMode, PERIOD_DAYS, stripePriceEnv } from "./config";
import {
  recordCollectedPayment,
  restoreReversedPayment,
  reverseCollectedPayment,
} from "@/server/referrals/record";
import { ENTITLED_STATUSES, getEntitledSubscription, getPlan } from "./subscriptions";
import { reportPaidInvoice, reportPaidPass } from "./gig-activity";
import { grantPassFromStripe, refundPassForStripeCharge } from "./pass";

export { getEntitledSubscription, getPlan } from "./subscriptions";

let stripeClient: Stripe | null = null;
export async function getStripe(): Promise<Stripe> {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured");
  if (!stripeClient) {
    const { default: StripeCtor } = await import("stripe");
    const account = process.env.STRIPE_ACCOUNT_ID;
    stripeClient = new StripeCtor(process.env.STRIPE_SECRET_KEY, account ? { stripeAccount: account } : undefined);
  }
  return stripeClient;
}

export async function listPlans() {
  const db = await getDb();
  return db.select().from(plans).where(eq(plans.active, true));
}

export async function listUserSubscriptions(userId: string) {
  const db = await getDb();
  return db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.createdAt));
}

/** Retired prices stay in the catalog for existing subscriptions, but new checkout cannot sell them. */
function rejectRetiredCheckout(_tier: Tier, period: BillingPeriod) {
  if (period !== "monthly") throw new Error("Only monthly plans are offered.");
}

/** Weekly and annual subscriptions keep access through the period already paid, then stop. */
export function stopsAtPeriodEnd(sub: { tier: Tier; period: BillingPeriod }) {
  return sub.period !== "monthly";
}

export async function startCheckout(user: { id: string; email: string }, tier: Tier, period: BillingPeriod) {
  rejectRetiredCheckout(tier, period);
  const plan = await getPlan(tier, period);
  if (!plan || !plan.active) throw new Error("Plan not available");
  await trackEvent("checkout_started", user.id, { tier, period, mode: billingMode() });

  if (billingMode() === "mock") {
    return { url: `/billing/mock-checkout?tier=${tier}&period=${period}` };
  }
  const priceId = plan.providerPriceId ?? process.env[stripePriceEnv(tier, period)];
  if (!priceId) throw new Error(`No Stripe price configured for ${tier}/${period} (set ${stripePriceEnv(tier, period)})`);
  const stripe = await getStripe();
  const existing = await getEntitledSubscription(user.id);
  if (existing?.provider === "stripe" && existing.providerSubscriptionId) {
    if (existing.tier === tier && existing.period === period) return { url: "/billing#plans" };
    await changeStripePlan(stripe, existing.providerSubscriptionId, { userId: user.id, tier, period, priceId });
    return { url: "/billing?checkout=success" };
  }
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    customer: existing?.providerCustomerId ?? undefined,
    customer_email: existing?.providerCustomerId ? undefined : user.email,
    client_reference_id: user.id,
    metadata: { userId: user.id, tier, period },
    subscription_data: { metadata: { userId: user.id, tier, period } },
    success_url: `${appUrl()}/billing?checkout=success`,
    cancel_url: `${appUrl()}/billing?checkout=cancelled#plans`,
  });
  return { url: session.url! };
}

/** Replace the price on the member's current subscription. A new Checkout session would bill a second plan. */
async function changeStripePlan(
  stripe: Stripe,
  subscriptionId: string,
  change: { userId: string; tier: Tier; period: BillingPeriod; priceId: string },
) {
  const current = await stripe.subscriptions.retrieve(subscriptionId);
  const item = current.items.data[0];
  if (!item) throw new Error("Subscription has no price to change");
  if (item.price.id === change.priceId) {
    await syncStripeSubscription(current);
    return;
  }
  let updated: Stripe.Subscription;
  try {
    updated = await stripe.subscriptions.update(
      subscriptionId,
      {
        items: [{ id: item.id, price: change.priceId }],
        metadata: { userId: change.userId, tier: change.tier, period: change.period },
        proration_behavior: "always_invoice",
        payment_behavior: "error_if_incomplete",
        cancel_at_period_end: false,
      },
      {
        // Same change retried after an error must not create another invoice.
        idempotencyKey: `plan_${subscriptionId}_${item.price.id}_${change.priceId}`,
        maxNetworkRetries: 0,
      },
    );
  } catch (err) {
    const after = await stripe.subscriptions.retrieve(subscriptionId);
    if (after.items.data[0]?.price.id === change.priceId) {
      updated = after;
    } else if ((err as { type?: string }).type === "StripeCardError") {
      throw new Error("The card on file could not be charged, so the plan was not changed.");
    } else {
      throw err;
    }
  }
  await syncStripeSubscription(updated);
  await trackEvent("upgrade_clicked", change.userId, { tier: change.tier, period: change.period, provider: "stripe" });
}

/** Local test-mode checkout. Replaces any current subscription (upgrade/downgrade immediately). */
export async function completeMockCheckout(userId: string, tier: Tier, period: BillingPeriod) {
  rejectRetiredCheckout(tier, period);
  if (billingMode() !== "mock") throw new Error("Mock checkout is disabled when Stripe is configured");
  const plan = await getPlan(tier, period);
  if (!plan || !plan.active) throw new Error("Plan not available");
  const db = await getDb();
  const now = new Date();
  const current = await getEntitledSubscription(userId);
  if (current) {
    await db.update(subscriptions).set({ status: "canceled", canceledAt: now, currentPeriodEnd: now }).where(eq(subscriptions.id, current.id));
  }
  const [sub] = await db
    .insert(subscriptions)
    .values({
      userId,
      tier,
      period,
      status: "active",
      provider: "mock",
      providerCustomerId: `mock_cus_${userId.slice(0, 8)}`,
      providerSubscriptionId: `mock_sub_${crypto.randomUUID()}`,
      currentPeriodEnd: new Date(now.getTime() + PERIOD_DAYS[period] * 86_400_000),
    })
    .returning();
  await recordAudit({ actor: { userId, label: "member" }, entityType: "subscription", entityId: sub.id, action: "subscription.started", after: { tier, period, provider: "mock" } });
  await trackEvent("subscription_started", userId, { tier, period, provider: "mock" });
  await trackRevenue(userId, { amountCents: plan.amountCents, currency: plan.currency, tier, period, provider: "mock" });
  const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
  if (user) {
    await recordCollectedPayment({
      paymentKey: `mock:${sub.id}:${sub.currentPeriodEnd.toISOString()}`,
      userId,
      tier,
      period,
      collectedCents: plan.amountCents,
      customerEmail: user.email,
    });
  }
  return sub;
}

export async function setCancelAtPeriodEnd(userId: string, cancel: boolean, actor: Actor) {
  const sub = await getEntitledSubscription(userId);
  if (!sub) throw new Error("No active subscription");
  const db = await getDb();
  if (sub.provider === "stripe" && sub.providerSubscriptionId) {
    const stripe = await getStripe();
    await stripe.subscriptions.update(sub.providerSubscriptionId, { cancel_at_period_end: cancel });
  }
  await db.update(subscriptions).set({ cancelAtPeriodEnd: cancel, canceledAt: cancel ? new Date() : null }).where(eq(subscriptions.id, sub.id));
  await recordAudit({ actor, entityType: "subscription", entityId: sub.id, action: cancel ? "subscription.cancel_scheduled" : "subscription.resumed" });
  if (cancel) await trackEvent("subscription_cancelled", userId, { tier: sub.tier, period: sub.period });
}

export async function openBillingPortal(userId: string) {
  const sub = await getEntitledSubscription(userId);
  if (billingMode() === "mock" || !sub?.providerCustomerId || sub.provider !== "stripe") return { url: "/billing" };
  const stripe = await getStripe();
  const session = await stripe.billingPortal.sessions.create({ customer: sub.providerCustomerId, return_url: `${appUrl()}/billing` });
  return { url: session.url };
}

function mapStripeStatus(s: string): Subscription["status"] {
  if (s === "active" || s === "trialing" || s === "past_due") return s;
  if (s === "canceled" || s === "unpaid" || s === "incomplete_expired") return "canceled";
  return "incomplete";
}

/** For invoice.paid only: null when the subscription is not tied to an existing user row. */
async function resolveStripeSubscriptionUserId(sub: Stripe.Subscription): Promise<string | null> {
  const db = await getDb();
  let userId = sub.metadata?.userId;
  if (!userId) {
    const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.providerSubscriptionId, sub.id));
    userId = existing?.userId;
  }
  if (!userId) return null;
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  return user ? userId : null;
}

/** Upserts local state from a Stripe subscription object. */
export async function syncStripeSubscription(sub: Stripe.Subscription) {
  const db = await getDb();
  const item = sub.items.data[0];
  const priceId = item?.price.id;
  const [plan] = priceId ? await db.select().from(plans).where(eq(plans.providerPriceId, priceId)) : [];
  const tier = (plan?.tier ?? sub.metadata?.tier) as Tier | undefined;
  const period = (plan?.period ?? sub.metadata?.period) as BillingPeriod | undefined;
  let userId = sub.metadata?.userId;
  if (!userId) {
    const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.providerSubscriptionId, sub.id));
    userId = existing?.userId;
  }
  if (!userId || !tier || !period) throw new Error(`Cannot map Stripe subscription ${sub.id}`);
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!user) throw new Error(`Unknown user for Stripe subscription ${sub.id}`);

  const periodEndSec =
    (item as unknown as { current_period_end?: number })?.current_period_end ??
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    Math.floor(Date.now() / 1000);
  const values = {
    userId,
    tier,
    period,
    status: mapStripeStatus(sub.status),
    provider: "stripe" as const,
    providerCustomerId: typeof sub.customer === "string" ? sub.customer : sub.customer.id,
    providerSubscriptionId: sub.id,
    currentPeriodEnd: new Date(periodEndSec * 1000),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
    canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
  };
  await db
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({ target: subscriptions.providerSubscriptionId, set: values });
  return values;
}

function subscriptionIdForInvoice(invoice: Stripe.Invoice): string | null {
  const subscription = invoice.parent?.subscription_details?.subscription;
  if (!subscription) return null;
  return typeof subscription === "string" ? subscription : subscription.id;
}

async function invoiceIdForCharge(stripe: Stripe, charge: Stripe.Charge): Promise<string | null> {
  const legacy = (charge as { invoice?: string | { id?: string } | null }).invoice;
  if (typeof legacy === "string") return legacy;
  if (legacy && typeof legacy === "object" && legacy.id) return legacy.id;
  const paymentIntentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!paymentIntentId) return null;
  const payments = await stripe.invoicePayments.list({
    limit: 1,
    payment: { type: "payment_intent", payment_intent: paymentIntentId },
  });
  const invoice = payments.data[0]?.invoice;
  if (!invoice || (typeof invoice === "object" && "deleted" in invoice)) return null;
  return typeof invoice === "string" ? invoice : invoice.id;
}

export async function handleStripeEvent(event: Stripe.Event) {
  const stripe = await getStripe();
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode === "payment" && session.metadata?.kind === "pass") {
        const userId = session.metadata.userId ?? session.client_reference_id;
        if (userId) {
          const granted = await grantPassFromStripe({ userId, paymentId: session.id, paidAt: new Date() });
          await reportPaidPass({ livemode: event.livemode, paymentId: session.id, granted });
        }
        break;
      }
      if (session.subscription) {
        const sub = await stripe.subscriptions.retrieve(typeof session.subscription === "string" ? session.subscription : session.subscription.id);
        const v = await syncStripeSubscription(sub);
        await trackEvent("subscription_started", v.userId, { tier: v.tier, period: v.period, provider: "stripe" });
      }
      break;
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      await refundPassForStripeCharge(charge);
      const invoiceId = await invoiceIdForCharge(stripe, charge);
      let refundId = charge.refunds?.data?.[0]?.id;
      if (invoiceId && !refundId) {
        const refunds = await stripe.refunds.list({ charge: charge.id, limit: 1 });
        refundId = refunds.data[0]?.id;
      }
      if (invoiceId && refundId) {
        await reverseCollectedPayment({ paymentKey: invoiceId, externalId: refundId });
      }
      break;
    }
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      if (!dispute.charge) break;
      const charge: Stripe.Charge =
        typeof dispute.charge === "string" ? await stripe.charges.retrieve(dispute.charge) : dispute.charge;
      const invoiceId = await invoiceIdForCharge(stripe, charge);
      if (invoiceId) {
        await reverseCollectedPayment({ paymentKey: invoiceId, externalId: dispute.id });
      }
      break;
    }
    case "charge.dispute.closed": {
      const dispute = event.data.object as Stripe.Dispute;
      if (dispute.status === "won") {
        await restoreReversedPayment({ externalId: dispute.id });
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncStripeSubscription(event.data.object as Stripe.Subscription);
      break;
    case "invoice.paid": {
      const invoice = event.data.object as Stripe.Invoice;
      if (invoice.amount_paid === 0) break;
      const subscriptionId = subscriptionIdForInvoice(invoice);
      if (!subscriptionId) break;
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      const userId = await resolveStripeSubscriptionUserId(sub);
      if (!userId) break;
      const v = await syncStripeSubscription(sub);
      const plan = await getPlan(v.tier, v.period);
      const [user] = await (await getDb()).select({ email: users.email }).from(users).where(eq(users.id, v.userId));
      if (!user || !plan) break;
      await recordCollectedPayment({
        paymentKey: invoice.id,
        userId: v.userId,
        tier: v.tier,
        period: v.period,
        collectedCents: invoice.amount_paid,
        customerEmail: user.email,
      });
      await trackRevenue(v.userId, {
        amountCents: invoice.amount_paid,
        currency: plan.currency,
        tier: v.tier,
        period: v.period,
        provider: "stripe",
      });
      await reportPaidInvoice({
        livemode: event.livemode,
        amountPaid: invoice.amount_paid,
        subscriptionId,
        paidAt: invoice.status_transitions?.paid_at,
        created: invoice.created,
      });
      break;
    }
    default:
      break;
  }
}

/**
 * Periodic reconciliation. Mock subscriptions renew or expire at period end;
 * Stripe subscriptions are refreshed from the API.
 */
export async function reconcileSubscriptions(now = new Date()) {
  const db = await getDb();
  const scheduled = await scheduleRetiredStripePlans(now);
  const due = await db
    .select()
    .from(subscriptions)
    .where(and(inArray(subscriptions.status, [...ENTITLED_STATUSES]), lte(subscriptions.currentPeriodEnd, now)));
  let renewed = 0;
  let expired = 0;
  for (const sub of due) {
    if (sub.provider === "mock") {
      if (sub.cancelAtPeriodEnd || stopsAtPeriodEnd(sub)) {
        await db.update(subscriptions).set({ status: "expired" }).where(eq(subscriptions.id, sub.id));
        expired++;
      } else {
        const plan = await getPlan(sub.tier, sub.period);
        const [user] = await db.select({ email: users.email }).from(users).where(eq(users.id, sub.userId));
        if (plan && user && sub.period === "monthly") {
          await recordCollectedPayment({
            paymentKey: `mock:${sub.id}:${sub.currentPeriodEnd.toISOString()}`,
            userId: sub.userId,
            tier: sub.tier,
            period: sub.period,
            collectedCents: plan.amountCents,
            customerEmail: user.email,
          });
        }
        await db
          .update(subscriptions)
          .set({ currentPeriodEnd: new Date(sub.currentPeriodEnd.getTime() + PERIOD_DAYS[sub.period] * 86_400_000) })
          .where(eq(subscriptions.id, sub.id));
        renewed++;
      }
    } else if (sub.provider === "stripe" && sub.providerSubscriptionId && process.env.STRIPE_SECRET_KEY) {
      const stripe = await getStripe();
      await syncStripeSubscription(await stripe.subscriptions.retrieve(sub.providerSubscriptionId));
    }
  }
  if (renewed || expired || scheduled) {
    await recordAudit({ actor: SYSTEM, entityType: "subscription", entityId: "*", action: "subscription.reconciled", after: { renewed, expired, scheduled } });
  }
  return { renewed, expired, scheduled };
}

/** Still-entitled Stripe subscriptions that are not monthly are set to cancel when the paid period ends. */
async function scheduleRetiredStripePlans(now: Date) {
  if (!process.env.STRIPE_SECRET_KEY) return 0;
  const db = await getDb();
  const open = await db
    .select()
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.provider, "stripe"),
        inArray(subscriptions.status, [...ENTITLED_STATUSES]),
        gt(subscriptions.currentPeriodEnd, now),
        eq(subscriptions.cancelAtPeriodEnd, false),
      ),
    );
  const retiring = open.filter((sub) => sub.provider === "stripe" && sub.providerSubscriptionId && stopsAtPeriodEnd(sub));
  if (!retiring.length) return 0;
  const stripe = await getStripe();
  for (const sub of retiring) {
    await stripe.subscriptions.update(sub.providerSubscriptionId!, { cancel_at_period_end: true });
    await db.update(subscriptions).set({ cancelAtPeriodEnd: true, canceledAt: now }).where(eq(subscriptions.id, sub.id));
  }
  return retiring.length;
}
