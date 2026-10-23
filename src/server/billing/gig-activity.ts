import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { subscriptions } from "@/server/db/schema";
import { reportLivePaidMembership } from "@/server/gig-activity/deliver";
import { passByPaymentId } from "./pass";

export async function reportPaidInvoice(input: {
  livemode: boolean;
  amountPaid: number;
  subscriptionId: string;
  paidAt: number | null | undefined;
  created: number;
}) {
  if (!input.livemode || input.amountPaid <= 0) return { recorded: false as const };
  const db = await getDb();
  const [row] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.providerSubscriptionId, input.subscriptionId))
    .limit(1);
  if (!row) return { recorded: false as const };
  const occurredAt = new Date((input.paidAt ?? input.created) * 1000);
  return reportLivePaidMembership({
    livemode: true,
    membershipId: `paid:${row.id}`,
    occurredAt,
  });
}

export async function reportPaidPass(input: {
  livemode: boolean;
  paymentId: string;
  granted: { id: string; startsAt: Date } | null;
}) {
  if (!input.livemode) return { recorded: false as const };
  const pass = input.granted ?? (await passByPaymentId(input.paymentId));
  if (!pass) return { recorded: false as const };
  return reportLivePaidMembership({
    livemode: true,
    membershipId: `paid:pass:${pass.id}`,
    occurredAt: pass.startsAt,
  });
}
