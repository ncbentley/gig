"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { requireAdmin } from "@/server/auth/guards";
import {
  markWithdrawalSent,
  rejectWithdrawal,
  requestWithdrawal,
  savePayoutAccountAction as savePayoutAccountServer,
} from "@/server/referrals/payouts";

export type ReferralFormState = { error?: string } | undefined;

export async function savePayoutAccountAction(_: ReferralFormState, form: FormData): Promise<ReferralFormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const accountHolderName = String(form.get("accountHolderName") ?? "").trim();
  const routingNumber = String(form.get("routingNumber") ?? "").trim();
  const accountNumber = String(form.get("accountNumber") ?? "").trim();
  try {
    const result = await savePayoutAccountServer({
      userId: user.id,
      accountHolderName,
      routingNumber,
      accountNumber,
    });
    if (result.error) return { error: result.error };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: message };
  }
  revalidatePath("/referrals");
  return undefined;
}

export async function requestWithdrawalAction(_: ReferralFormState, form: FormData): Promise<ReferralFormState> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const amount = String(form.get("amount") ?? "").trim();
  const amountCents = Math.round(Number(amount) * 100);
  if (!Number.isFinite(amountCents) || !Number.isInteger(amountCents)) {
    return { error: "Enter a withdrawal amount." };
  }
  try {
    await requestWithdrawal({ userId: user.id, amountCents });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return { error: message };
  }
  revalidatePath("/referrals");
  return undefined;
}

export async function markWithdrawalSentAction(form: FormData) {
  const { user } = await requireAdmin();
  const withdrawalId = String(form.get("withdrawalId") ?? "").trim();
  try {
    await markWithdrawalSent({ withdrawalId, adminId: user.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    redirect(`/admin/referrals?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/admin/referrals");
  redirect("/admin/referrals");
}

export async function rejectWithdrawalAction(form: FormData) {
  const { user } = await requireAdmin();
  const withdrawalId = String(form.get("withdrawalId") ?? "").trim();
  try {
    await rejectWithdrawal({ withdrawalId, adminId: user.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Something went wrong.";
    redirect(`/admin/referrals?error=${encodeURIComponent(message)}`);
  }
  revalidatePath("/admin/referrals");
  redirect("/admin/referrals");
}
