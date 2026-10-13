import { UsersRound, Wallet } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader, SectionTitle } from "@/components/page-header";
import { ReferralPayoutForm } from "@/components/referral-payout-form";
import { ReferralWithdrawalForm } from "@/components/referral-withdrawal-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/format";
import { appUrl } from "@/server/auth";
import { getDb } from "@/server/db";
import {
  referralAdjustments,
  referralAllocations,
  referralFees,
  referralPayoutAccounts,
  referralWithdrawals,
} from "@/server/db/schema";
import { TIER_LABEL } from "@/server/entitlements/config";
import { getViewer } from "@/server/entitlements/service";
import { feeLabel, requestableBalance } from "@/server/referrals/money";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

export const metadata: Metadata = { title: "Referrals" };

const MIN_WITHDRAWAL_CENTS = 2500;

export default async function ReferralsPage() {
  const viewer = await getViewer();
  const user = viewer.user;
  if (!user) return null;

  const db = await getDb();

  const [fees, [adjustmentsSum], [sentSum], [pendingSum], [pendingWithdrawal], [payoutAccount]] = await Promise.all([
    db
      .select()
      .from(referralFees)
      .where(eq(referralFees.referrerUserId, user.id))
      .orderBy(desc(referralFees.createdAt)),
    db
      .select({ total: sql<number>`coalesce(sum(${referralAdjustments.amountCents}), 0)` })
      .from(referralAdjustments)
      .innerJoin(referralFees, eq(referralAdjustments.feeId, referralFees.id))
      .where(eq(referralFees.referrerUserId, user.id)),
    db
      .select({ total: sql<number>`coalesce(sum(${referralWithdrawals.amountCents}), 0)` })
      .from(referralWithdrawals)
      .where(and(eq(referralWithdrawals.userId, user.id), eq(referralWithdrawals.status, "sent"))),
    db
      .select({ total: sql<number>`coalesce(sum(${referralWithdrawals.amountCents}), 0)` })
      .from(referralWithdrawals)
      .where(and(eq(referralWithdrawals.userId, user.id), eq(referralWithdrawals.status, "pending"))),
    db
      .select({ id: referralWithdrawals.id, amountCents: referralWithdrawals.amountCents })
      .from(referralWithdrawals)
      .where(and(eq(referralWithdrawals.userId, user.id), eq(referralWithdrawals.status, "pending")))
      .limit(1),
    db
      .select({ accountHolderName: referralPayoutAccounts.accountHolderName })
      .from(referralPayoutAccounts)
      .where(eq(referralPayoutAccounts.userId, user.id))
      .limit(1),
  ]);

  const feeIds = fees.map((fee) => fee.id);
  const allocatedByFee = new Map<string, number>();
  const clawedByFee = new Map<string, number>();

  if (feeIds.length > 0) {
    const [allocatedRows, clawbackRows] = await Promise.all([
      db
        .select({
          feeId: referralAllocations.feeId,
          total: sql<number>`coalesce(sum(${referralAllocations.amountCents}), 0)`,
        })
        .from(referralAllocations)
        .innerJoin(referralWithdrawals, eq(referralAllocations.withdrawalId, referralWithdrawals.id))
        .where(and(inArray(referralAllocations.feeId, feeIds), eq(referralWithdrawals.status, "sent")))
        .groupBy(referralAllocations.feeId),
      db
        .select({
          feeId: referralAdjustments.feeId,
          total: sql<number>`coalesce(sum(case when ${referralAdjustments.amountCents} < 0 then -${referralAdjustments.amountCents} else 0 end), 0)`,
        })
        .from(referralAdjustments)
        .where(inArray(referralAdjustments.feeId, feeIds))
        .groupBy(referralAdjustments.feeId),
    ]);
    for (const row of allocatedRows) allocatedByFee.set(row.feeId, Number(row.total));
    for (const row of clawbackRows) clawedByFee.set(row.feeId, Number(row.total));
  }

  const requestableCents = requestableBalance({
    fees: fees.map((fee) => ({ amountCents: fee.amountCents, voidedCents: fee.voidedCents })),
    adjustmentsCents: Number(adjustmentsSum?.total ?? 0),
    sentCents: Number(sentSum?.total ?? 0),
    pendingCents: Number(pendingSum?.total ?? 0),
  });

  const referralCode = user.referralCode;
  const signupUrl = referralCode ? `${appUrl()}/?ref=${encodeURIComponent(referralCode)}` : null;
  const withdrawalDisabled =
    requestableCents < MIN_WITHDRAWAL_CENTS || pendingWithdrawal !== undefined;

  return (
    <>
      <PageHeader
        icon={UsersRound}
        size="sm"
        title="Referrals"
        description="Earn a fee when someone you referred pays a full monthly price. Withdraw at least $25 by bank transfer after an admin sends it."
      />
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your link</CardTitle>
            <CardDescription>Share your code before friends sign up, or let them enter it at checkout until their first monthly payment.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {referralCode ? (
              <>
                <div>
                  <span className="text-muted-foreground">Code: </span>
                  <span className="font-mono font-semibold tracking-wide">{referralCode}</span>
                </div>
                <div className="break-all">
                  <span className="text-muted-foreground">Signup URL: </span>
                  <a href={signupUrl!} className="text-[#8db6ff] underline-offset-2 hover:underline">
                    {signupUrl}
                  </a>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">Your code is created with your first monthly payment.</p>
            )}
          </CardContent>
        </Card>

        <Card className="panel-gold ring-primary/55 shadow-[0_0_28px_-8px_rgb(245_197_66/0.55)]">
          <CardHeader>
            <SectionTitle icon={Wallet} title="Balance" className="mb-0" />
          </CardHeader>
          <CardContent>
            <p className="font-heading text-3xl font-extrabold tabular-nums tracking-tight">{fmtMoney(requestableCents)}</p>
            <p className="mt-1 text-sm text-muted-foreground">Available to withdraw after voids, adjustments, and pending requests.</p>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Payout account</CardTitle>
              <CardDescription>Bank details are encrypted. Routing and account numbers are not shown again after you save.</CardDescription>
            </CardHeader>
            <CardContent>
              <ReferralPayoutForm accountHolderName={payoutAccount?.accountHolderName ?? null} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Withdraw</CardTitle>
              <CardDescription>Requests stay pending until an admin marks the transfer sent or rejects it.</CardDescription>
            </CardHeader>
            <CardContent>
              <ReferralWithdrawalForm
                requestableCents={requestableCents}
                pendingAmountCents={pendingWithdrawal?.amountCents ?? null}
                disabled={withdrawalDisabled}
              />
            </CardContent>
          </Card>
        </div>

        <Card className="gap-0 py-0">
          <CardHeader className="border-b border-border/60">
            <CardTitle className="text-base">Fee history</CardTitle>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Fee</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {fees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No referral fees yet.
                  </TableCell>
                </TableRow>
              ) : (
                fees.map((fee) => {
                  const allocatedCents = allocatedByFee.get(fee.id) ?? 0;
                  const clawedBackCents = clawedByFee.get(fee.id) ?? 0;
                  const label = feeLabel({
                    amountCents: fee.amountCents,
                    voidedCents: fee.voidedCents,
                    allocatedCents,
                    clawedBackCents,
                  });
                  return (
                    <TableRow key={fee.id}>
                      <TableCell className="tabular-nums">{fmtDate(fee.createdAt)}</TableCell>
                      <TableCell className="max-w-48 whitespace-normal [overflow-wrap:anywhere]">{fee.customerEmail}</TableCell>
                      <TableCell>{TIER_LABEL[fee.cappedTier]}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(fee.amountCents)}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">{label}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
