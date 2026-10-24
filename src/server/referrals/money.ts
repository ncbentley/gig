import { fmtMoney } from "@/lib/format";
import type { Tier } from "@/server/db/schema";

const RANK: Record<Tier, number> = { basic: 0, silver: 1, gold: 2 };
export const REFERRAL_FEE_CENTS: Record<Tier, number> = { basic: 1100, silver: 2200, gold: 3300 };
/** Manual bank withdrawal floor. The app does not move the money. */
export const MIN_WITHDRAWAL_CENTS = 2500;

/** Rules a buyer can read before paying. Amounts come from the constants above. */
export function referralRulesBesidePurchase(passPriceCents: number) {
  return `The ${fmtMoney(passPriceCents)} pass does not create a referral code and earns no commission. A code is created with the first monthly payment. The fee is the lower of the two monthly tiers, and only when the collected amount equals that customer's catalog monthly price. Manual withdrawals start at ${fmtMoney(MIN_WITHDRAWAL_CENTS)}.`;
}

export function lowerTier(a: Tier, b: Tier): Tier {
  return RANK[a] <= RANK[b] ? a : b;
}

export function feeForPayment(input: {
  collectedCents: number;
  customerCatalogCents: number;
  referrerTier: Tier;
  customerTier: Tier;
  referrerEligible: boolean;
}): number | null {
  if (!input.referrerEligible) return null;
  if (input.collectedCents !== input.customerCatalogCents) return null;
  return REFERRAL_FEE_CENTS[lowerTier(input.referrerTier, input.customerTier)];
}

export function reverseFee(input: { amountCents: number; voidedCents: number; allocatedCents: number }) {
  const unallocated = input.amountCents - input.voidedCents - input.allocatedCents;
  return { voidedCents: input.voidedCents + unallocated, clawbackCents: input.allocatedCents };
}

export function requestableBalance(input: {
  fees: { amountCents: number; voidedCents: number }[];
  adjustmentsCents: number;
  sentCents: number;
  pendingCents: number;
}) {
  const fees = input.fees.reduce((sum, fee) => sum + fee.amountCents - fee.voidedCents, 0);
  return fees + input.adjustmentsCents - input.sentCents - input.pendingCents;
}

export function feeLabel(input: {
  amountCents: number;
  voidedCents: number;
  allocatedCents: number;
  clawedBackCents: number;
}) {
  if (input.clawedBackCents > 0) return "reversed after payout";
  if (input.voidedCents === input.amountCents && input.allocatedCents === 0) return "voided";
  if (input.allocatedCents === input.amountCents && input.voidedCents === 0) return "paid out";
  return "open";
}

export function allocateFifo(
  fees: { id: string; createdAt: number; amountCents: number; voidedCents: number; allocatedCents: number }[],
  amount: number,
) {
  const ordered = [...fees].sort((a, b) => a.createdAt - b.createdAt);
  const out: { feeId: string; cents: number }[] = [];
  let left = amount;
  for (const fee of ordered) {
    if (left <= 0) break;
    const open = fee.amountCents - fee.voidedCents - fee.allocatedCents;
    if (open <= 0) continue;
    const take = Math.min(open, left);
    out.push({ feeId: fee.id, cents: take });
    left -= take;
  }
  if (left !== 0) throw new Error("Withdrawal exceeds open fees");
  return out;
}
