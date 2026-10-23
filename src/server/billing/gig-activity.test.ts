import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { gigActivityEvents, jobs, plans, subscriptions, users } from "@/server/db/schema";
import { reportPaidInvoice, reportPaidPass } from "./gig-activity";

beforeAll(async () => {
  await runMigrations();
}, 60_000);

afterEach(() => {
  delete process.env.AETHERION_GIG_ACTIVITY_KEY;
});

afterAll(async () => {
  await closeDb();
});

describe("reportPaidInvoice", () => {
  it("records paid:<subscriptionId> once for a live invoice and ignores test mode and renewals", async () => {
    const db = await getDb();
    await db
      .insert(plans)
      .values({ tier: "basic", period: "monthly", amountCents: 3300, currency: "usd", active: true })
      .onConflictDoUpdate({ target: [plans.tier, plans.period], set: { amountCents: 3300, currency: "usd", active: true } });
    const [user] = await db.insert(users).values({ email: `live-pay-${crypto.randomUUID()}@example.com`, passwordHash: "x" }).returning();
    const [sub] = await db
      .insert(subscriptions)
      .values({
        userId: user.id,
        tier: "basic",
        period: "monthly",
        status: "active",
        provider: "stripe",
        providerCustomerId: "cus_x",
        providerSubscriptionId: `sub_${crypto.randomUUID()}`,
        currentPeriodEnd: new Date("2026-02-15T00:00:00.000Z"),
      })
      .returning();

    const paidAt = 1_700_000_100;
    expect(
      await reportPaidInvoice({
        livemode: false,
        amountPaid: 3300,
        subscriptionId: sub.providerSubscriptionId!,
        paidAt,
        created: paidAt,
      }),
    ).toEqual({ recorded: false });
    expect(
      await reportPaidInvoice({
        livemode: true,
        amountPaid: 0,
        subscriptionId: sub.providerSubscriptionId!,
        paidAt,
        created: paidAt,
      }),
    ).toEqual({ recorded: false });

    const first = await reportPaidInvoice({
      livemode: true,
      amountPaid: 3300,
      subscriptionId: sub.providerSubscriptionId!,
      paidAt,
      created: paidAt,
    });
    const second = await reportPaidInvoice({
      livemode: true,
      amountPaid: 3300,
      subscriptionId: sub.providerSubscriptionId!,
      paidAt: paidAt + 86_400,
      created: paidAt + 86_400,
    });
    expect(first).toEqual({ recorded: true });
    expect(second).toEqual({ recorded: true });
    const rows = await db.select().from(gigActivityEvents).where(eq(gigActivityEvents.id, `paid:${sub.id}`));
    expect(rows).toHaveLength(1);
    expect(rows[0].occurredAt.toISOString()).toBe(new Date(paidAt * 1000).toISOString());

    await db.delete(jobs).where(eq(jobs.dedupeKey, `gig-activity:paid:${sub.id}`));
    await db.delete(gigActivityEvents).where(eq(gigActivityEvents.id, `paid:${sub.id}`));
    await db.delete(subscriptions).where(eq(subscriptions.id, sub.id));
    await db.delete(users).where(eq(users.id, user.id));
  });
});

describe("reportPaidPass", () => {
  it("records paid:pass:<passId> for a live grant and looks up the pass on replay", async () => {
    const { grantPassFromStripe } = await import("./pass");
    const db = await getDb();
    const [user] = await db.insert(users).values({ email: `live-pass-${crypto.randomUUID()}@example.com`, passwordHash: "x" }).returning();
    const paidAt = new Date("2026-10-01T12:00:00.000Z");
    const paymentId = `cs_${crypto.randomUUID()}`;
    const pass = await grantPassFromStripe({ userId: user.id, paymentId, paidAt });
    expect(pass).not.toBeNull();

    expect(await reportPaidPass({ livemode: false, paymentId, granted: pass })).toEqual({ recorded: false });
    expect(await reportPaidPass({ livemode: true, paymentId, granted: pass })).toEqual({ recorded: true });
    expect(await reportPaidPass({ livemode: true, paymentId, granted: null })).toEqual({ recorded: true });

    const rows = await db.select().from(gigActivityEvents).where(eq(gigActivityEvents.id, `paid:pass:${pass!.id}`));
    expect(rows).toHaveLength(1);

    await db.delete(jobs).where(eq(jobs.dedupeKey, `gig-activity:paid:pass:${pass!.id}`));
    await db.delete(gigActivityEvents).where(eq(gigActivityEvents.id, `paid:pass:${pass!.id}`));
    await db.delete(users).where(eq(users.id, user.id));
  });
});
