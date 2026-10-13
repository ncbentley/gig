import { UsersRound } from "lucide-react";
import { markWithdrawalSentAction, rejectWithdrawalAction } from "@/app/actions/referrals";
import { EmptyState } from "@/components/admin-bits";
import { PageHeader, SectionTitle } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtDate, fmtMoney } from "@/lib/format";
import { requireAdmin } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { referralAdjustments, referralFees, referralWithdrawals, users } from "@/server/db/schema";
import { payoutAccountForAdmin } from "@/server/referrals/payouts";
import { desc, eq, sql } from "drizzle-orm";

export const metadata = { title: "Referral payouts" };

export default async function AdminReferralsPage() {
  await requireAdmin();
  const db = await getDb();

  const pending = await db
    .select({
      id: referralWithdrawals.id,
      amountCents: referralWithdrawals.amountCents,
      requestedAt: referralWithdrawals.requestedAt,
      userId: referralWithdrawals.userId,
      email: users.email,
    })
    .from(referralWithdrawals)
    .innerJoin(users, eq(users.id, referralWithdrawals.userId))
    .where(eq(referralWithdrawals.status, "pending"))
    .orderBy(referralWithdrawals.requestedAt);

  const pendingRows = await Promise.all(
    pending.map(async (row) => ({
      ...row,
      payout: await payoutAccountForAdmin(row.userId),
    })),
  );

  const recentFees = await db
    .select({
      id: referralFees.id,
      createdAt: referralFees.createdAt,
      customerEmail: referralFees.customerEmail,
      amountCents: referralFees.amountCents,
      voidedCents: referralFees.voidedCents,
      adjustmentsTotal: sql<number>`coalesce((
        select sum(${referralAdjustments.amountCents})
        from ${referralAdjustments}
        where ${referralAdjustments.feeId} = ${referralFees.id}
      ), 0)`,
    })
    .from(referralFees)
    .orderBy(desc(referralFees.createdAt))
    .limit(50);

  return (
    <>
      <PageHeader
        icon={UsersRound}
        size="sm"
        title="Referral payouts"
        description="Send ACH transfers manually, then mark requests sent or reject them. The app never moves money."
      />
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <SectionTitle icon={UsersRound} title="Pending withdrawals" className="mb-0" />
          </CardHeader>
          <CardContent className="space-y-4">
            {pendingRows.length === 0 ? (
              <EmptyState icon={UsersRound}>No withdrawals are waiting.</EmptyState>
            ) : (
              pendingRows.map((row) => {
                const payout = row.payout;
                const unreadable = payout !== null && "readable" in payout && payout.readable === false;
                return (
                  <div key={row.id} className="rounded-xl border border-glow/30 bg-[#0a1630]/50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="space-y-1 text-sm">
                        <div className="font-medium [overflow-wrap:anywhere]">{row.email}</div>
                        <div className="tabular-nums text-muted-foreground">
                          {fmtMoney(row.amountCents)} · requested {fmtDate(row.requestedAt)}
                        </div>
                        {payout === null ? (
                          <p className="text-muted-foreground">No payout account on file.</p>
                        ) : unreadable ? (
                          <p className="text-amber-300">The stored account cannot be read</p>
                        ) : (
                          <div className="space-y-0.5 font-mono text-xs text-muted-foreground">
                            <div>{payout.accountHolderName}</div>
                            <div>Routing {payout.routingNumber}</div>
                            <div>Account {payout.accountNumber}</div>
                          </div>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {!unreadable && payout !== null && (
                          <form action={markWithdrawalSentAction}>
                            <input type="hidden" name="withdrawalId" value={row.id} />
                            <Button type="submit" size="sm">
                              Mark sent
                            </Button>
                          </form>
                        )}
                        <form action={rejectWithdrawalAction}>
                          <input type="hidden" name="withdrawalId" value={row.id} />
                          <Button type="submit" size="sm" variant="outline">
                            Reject
                          </Button>
                        </form>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="gap-0 py-0">
          <CardHeader className="border-b border-border/60">
            <SectionTitle title="Recent fees" className="mb-0" />
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead className="text-right">Fee</TableHead>
                <TableHead className="text-right">Voided</TableHead>
                <TableHead className="text-right">Adjustments</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentFees.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">
                    No referral fees recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                recentFees.map((fee) => (
                  <TableRow key={fee.id}>
                    <TableCell className="tabular-nums">{fmtDate(fee.createdAt)}</TableCell>
                    <TableCell className="max-w-48 whitespace-normal [overflow-wrap:anywhere]">{fee.customerEmail}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(fee.amountCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(fee.voidedCents)}</TableCell>
                    <TableCell className="text-right tabular-nums">{fmtMoney(Number(fee.adjustmentsTotal))}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      </div>
    </>
  );
}
