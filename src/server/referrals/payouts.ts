import { and, eq, sql } from "drizzle-orm";
import { recordAudit } from "@/server/audit";
import { decryptSecret, encryptSecret } from "@/server/crypto/secret";
import { getDb } from "@/server/db";
import {
  referralAdjustments,
  referralAllocations,
  referralFees,
  referralPayoutAccounts,
  referralWithdrawals,
} from "@/server/db/schema";
import { allocateFifo, requestableBalance } from "./money";

const MIN_WITHDRAWAL_CENTS = 2500;

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  );
}

export type SavePayoutAccountInput = {
  userId: string;
  accountHolderName: string;
  routingNumber: string;
  accountNumber: string;
};

async function loadRequestableBalanceCents(userId: string) {
  const db = await getDb();

  const fees = await db
    .select({
      id: referralFees.id,
      amountCents: referralFees.amountCents,
      voidedCents: referralFees.voidedCents,
    })
    .from(referralFees)
    .where(eq(referralFees.referrerUserId, userId));

  const [adjustmentsSum] = await db
    .select({ total: sql<number>`coalesce(sum(${referralAdjustments.amountCents}), 0)` })
    .from(referralAdjustments)
    .innerJoin(referralFees, eq(referralAdjustments.feeId, referralFees.id))
    .where(eq(referralFees.referrerUserId, userId));

  const [sentSum] = await db
    .select({ total: sql<number>`coalesce(sum(${referralWithdrawals.amountCents}), 0)` })
    .from(referralWithdrawals)
    .where(and(eq(referralWithdrawals.userId, userId), eq(referralWithdrawals.status, "sent")));

  const [pendingSum] = await db
    .select({ total: sql<number>`coalesce(sum(${referralWithdrawals.amountCents}), 0)` })
    .from(referralWithdrawals)
    .where(and(eq(referralWithdrawals.userId, userId), eq(referralWithdrawals.status, "pending")));

  return requestableBalance({
    fees,
    adjustmentsCents: Number(adjustmentsSum?.total ?? 0),
    sentCents: Number(sentSum?.total ?? 0),
    pendingCents: Number(pendingSum?.total ?? 0),
  });
}

export async function savePayoutAccount(input: SavePayoutAccountInput) {
  const db = await getDb();
  const routingEncrypted = encryptSecret(input.routingNumber);
  const accountEncrypted = encryptSecret(input.accountNumber);

  await db
    .insert(referralPayoutAccounts)
    .values({
      userId: input.userId,
      accountHolderName: input.accountHolderName,
      routingEncrypted,
      accountEncrypted,
    })
    .onConflictDoUpdate({
      target: referralPayoutAccounts.userId,
      set: {
        accountHolderName: input.accountHolderName,
        routingEncrypted,
        accountEncrypted,
        updatedAt: new Date(),
      },
    });

  await recordAudit({
    actor: { userId: input.userId, label: "member" },
    entityType: "referral_payout_account",
    entityId: input.userId,
    action: "referral.payout_account.updated",
    after: { userId: input.userId },
  });
}

export async function savePayoutAccountAction(input: SavePayoutAccountInput) {
  try {
    await savePayoutAccount(input);
    return {};
  } catch (error) {
    if (error instanceof Error && error.message === "APP_SECRET must be set to store credentials.") {
      return { error: "The payout account cannot be saved yet." };
    }
    throw error;
  }
}

export async function requestWithdrawal(input: { userId: string; amountCents: number }) {
  const db = await getDb();

  const [payoutAccount] = await db
    .select({ userId: referralPayoutAccounts.userId })
    .from(referralPayoutAccounts)
    .where(eq(referralPayoutAccounts.userId, input.userId));
  if (!payoutAccount) {
    throw new Error("Add a bank account before requesting a withdrawal.");
  }

  if (!Number.isInteger(input.amountCents) || input.amountCents < 1) {
    throw new Error("Enter a withdrawal amount.");
  }

  if (input.amountCents < MIN_WITHDRAWAL_CENTS) {
    throw new Error("The minimum withdrawal is $25.");
  }

  const [pendingWithdrawal] = await db
    .select({ id: referralWithdrawals.id })
    .from(referralWithdrawals)
    .where(and(eq(referralWithdrawals.userId, input.userId), eq(referralWithdrawals.status, "pending")));
  if (pendingWithdrawal) {
    throw new Error("A withdrawal is already waiting.");
  }

  const balance = await loadRequestableBalanceCents(input.userId);
  if (input.amountCents > balance) {
    throw new Error("The withdrawal is larger than the available balance.");
  }

  try {
    await db.insert(referralWithdrawals).values({
      userId: input.userId,
      amountCents: input.amountCents,
      status: "pending",
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new Error("A withdrawal is already waiting.");
    }
    throw error;
  }
}

export async function markWithdrawalSent(input: { withdrawalId: string; adminId: string }) {
  const db = await getDb();

  const [withdrawal] = await db
    .select()
    .from(referralWithdrawals)
    .where(eq(referralWithdrawals.id, input.withdrawalId));
  if (!withdrawal) {
    throw new Error("That withdrawal is not waiting.");
  }

  const feeRows = await db
    .select({
      id: referralFees.id,
      createdAt: referralFees.createdAt,
      amountCents: referralFees.amountCents,
      voidedCents: referralFees.voidedCents,
    })
    .from(referralFees)
    .where(eq(referralFees.referrerUserId, withdrawal.userId));

  const allocatedRows = await db
    .select({
      feeId: referralAllocations.feeId,
      total: sql<number>`coalesce(sum(${referralAllocations.amountCents}), 0)`,
    })
    .from(referralAllocations)
    .innerJoin(referralWithdrawals, eq(referralAllocations.withdrawalId, referralWithdrawals.id))
    .where(
      and(eq(referralWithdrawals.userId, withdrawal.userId), eq(referralWithdrawals.status, "sent")),
    )
    .groupBy(referralAllocations.feeId);

  const allocatedByFee = new Map(allocatedRows.map((row) => [row.feeId, Number(row.total)]));

  let allocations: { feeId: string; cents: number }[];
  try {
    allocations = allocateFifo(
      feeRows.map((fee) => ({
        id: fee.id,
        createdAt: fee.createdAt.getTime(),
        amountCents: fee.amountCents,
        voidedCents: fee.voidedCents,
        allocatedCents: allocatedByFee.get(fee.id) ?? 0,
      })),
      withdrawal.amountCents,
    );
  } catch (error) {
    if (error instanceof Error && error.message === "Withdrawal exceeds open fees") {
      throw new Error("The withdrawal is larger than the available balance.");
    }
    throw error;
  }

  const resolvedAt = new Date();

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(referralWithdrawals)
      .set({
        status: "sent",
        resolvedAt,
        resolvedByUserId: input.adminId,
      })
      .where(
        and(
          eq(referralWithdrawals.id, input.withdrawalId),
          eq(referralWithdrawals.status, "pending"),
        ),
      )
      .returning();
    if (!updated) {
      throw new Error("That withdrawal is not waiting.");
    }

    if (allocations.length > 0) {
      await tx.insert(referralAllocations).values(
        allocations.map((allocation) => ({
          withdrawalId: updated.id,
          feeId: allocation.feeId,
          amountCents: allocation.cents,
        })),
      );
    }

    await recordAudit(
      {
        actor: { userId: input.adminId, label: "admin" },
        entityType: "referral_withdrawal",
        entityId: updated.id,
        action: "referral.withdrawal.sent",
        after: { withdrawalId: updated.id, amountCents: updated.amountCents },
      },
      tx,
    );
  });

  return { allocations };
}

export async function rejectWithdrawal(input: { withdrawalId: string; adminId: string }) {
  const db = await getDb();
  const resolvedAt = new Date();

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(referralWithdrawals)
      .set({
        status: "rejected",
        resolvedAt,
        resolvedByUserId: input.adminId,
      })
      .where(
        and(
          eq(referralWithdrawals.id, input.withdrawalId),
          eq(referralWithdrawals.status, "pending"),
        ),
      )
      .returning();
    if (!updated) {
      throw new Error("That withdrawal is not waiting.");
    }

    await recordAudit(
      {
        actor: { userId: input.adminId, label: "admin" },
        entityType: "referral_withdrawal",
        entityId: updated.id,
        action: "referral.withdrawal.rejected",
        after: { withdrawalId: updated.id, amountCents: updated.amountCents },
      },
      tx,
    );
  });
}

export async function payoutAccountForAdmin(userId: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(referralPayoutAccounts)
    .where(eq(referralPayoutAccounts.userId, userId));
  if (!row) return null;

  try {
    return {
      accountHolderName: row.accountHolderName,
      routingNumber: decryptSecret(row.routingEncrypted),
      accountNumber: decryptSecret(row.accountEncrypted),
    };
  } catch {
    return { readable: false as const };
  }
}
