import { and, eq, gt, inArray } from "drizzle-orm";
import { trackEvent } from "@/server/analytics";
import { appUrl } from "@/server/auth";
import { getDb } from "@/server/db";
import { accessPasses } from "@/server/db/schema";
import { PASS_MS } from "@/server/entitlements/trial";
import { billingMode } from "./config";
import { getEntitledSubscription, getStripe } from "./service";

export const PASS_PRICE_CENTS = 1000;

export async function activePass(userId: string, now = new Date()) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(accessPasses)
    .where(and(eq(accessPasses.userId, userId), eq(accessPasses.status, "paid"), gt(accessPasses.endsAt, now)))
    .limit(1);
  return row ?? null;
}

export async function completeMockPass(userId: string, now = new Date()) {
  if (billingMode() !== "mock") throw new Error("Mock checkout is disabled when Stripe is configured");
  if (await activePass(userId, now)) throw new Error("A full-access pass is already active.");
  const db = await getDb();
  const startsAt = now;
  const endsAt = new Date(now.getTime() + PASS_MS);
  const [pass] = await db
    .insert(accessPasses)
    .values({
      userId,
      amountCents: PASS_PRICE_CENTS,
      currency: "usd",
      status: "paid",
      provider: "mock",
      providerPaymentId: `mock_pass_${crypto.randomUUID()}`,
      startsAt,
      endsAt,
    })
    .returning();
  await trackEvent("pass_purchased", userId, { amountCents: PASS_PRICE_CENTS, provider: "mock" });
  return pass;
}

export async function startPassCheckout(user: { id: string; email: string }) {
  const now = new Date();
  if (await activePass(user.id, now)) throw new Error("A full-access pass is already active.");
  await trackEvent("checkout_started", user.id, { kind: "pass", mode: billingMode() });

  if (billingMode() === "mock") {
    return { url: `/billing/mock-checkout?pass=1` };
  }
  const stripe = await getStripe();
  const existing = await getEntitledSubscription(user.id);
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: PASS_PRICE_CENTS,
          product_data: { name: "10-Day Full-Access Pass" },
        },
        quantity: 1,
      },
    ],
    customer: existing?.providerCustomerId ?? undefined,
    customer_email: existing?.providerCustomerId ? undefined : user.email,
    client_reference_id: user.id,
    metadata: { userId: user.id, kind: "pass" },
    success_url: `${appUrl()}/billing?checkout=success`,
    cancel_url: `${appUrl()}/billing?checkout=cancelled`,
  });
  return { url: session.url! };
}

export async function grantPassFromStripe(input: { userId: string; paymentId: string; paidAt: Date }) {
  if (await activePass(input.userId, input.paidAt)) return null;
  const db = await getDb();
  const startsAt = input.paidAt;
  const endsAt = new Date(input.paidAt.getTime() + PASS_MS);
  const [pass] = await db
    .insert(accessPasses)
    .values({
      userId: input.userId,
      amountCents: PASS_PRICE_CENTS,
      currency: "usd",
      status: "paid",
      provider: "stripe",
      providerPaymentId: input.paymentId,
      startsAt,
      endsAt,
    })
    .onConflictDoNothing({ target: accessPasses.providerPaymentId })
    .returning();
  if (pass) {
    await trackEvent("pass_purchased", input.userId, { amountCents: PASS_PRICE_CENTS, provider: "stripe" });
  }
  return pass ?? null;
}

export async function refundPass(providerPaymentId: string) {
  const db = await getDb();
  await db.update(accessPasses).set({ status: "refunded" }).where(eq(accessPasses.providerPaymentId, providerPaymentId));
}

export async function refundPassForStripeCharge(charge: { id: string; payment_intent?: string | { id: string } | null }) {
  const ids = [charge.id];
  const pi = charge.payment_intent;
  let piId: string | undefined;
  if (typeof pi === "string") piId = pi;
  else if (pi && typeof pi === "object" && "id" in pi) piId = pi.id;
  if (piId) {
    ids.push(piId);
    if (billingMode() === "stripe") {
      try {
        const stripe = await getStripe();
        const sessions = await stripe.checkout.sessions.list({ payment_intent: piId, limit: 1 });
        if (sessions.data[0]?.id) ids.push(sessions.data[0].id);
      } catch {
        /* no matching pass without session id */
      }
    }
  }

  const db = await getDb();
  const [pass] = await db
    .select({ providerPaymentId: accessPasses.providerPaymentId })
    .from(accessPasses)
    .where(inArray(accessPasses.providerPaymentId, ids))
    .limit(1);
  if (!pass) return;
  await refundPass(pass.providerPaymentId);
}
