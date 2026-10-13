import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { users } from "@/server/db/schema";

export async function referrerIdForCode(code: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, code));
  return row?.id ?? null;
}

export async function referralCodeForUserId(userId: string): Promise<string | null> {
  const db = await getDb();
  const [row] = await db.select({ referralCode: users.referralCode }).from(users).where(eq(users.id, userId));
  return row?.referralCode ?? null;
}

export async function setReferrer(input: { userId: string; code: string }) {
  const db = await getDb();
  const [payer] = await db.select().from(users).where(eq(users.id, input.userId));
  if (!payer) return;

  if (payer.referralLockedAt) {
    throw new Error("The referrer is already locked.");
  }

  const referrerId = await referrerIdForCode(input.code);
  if (!referrerId) {
    throw new Error("That referral code was not found.");
  }

  if (referrerId === payer.id) {
    throw new Error("Enter a different member's code.");
  }

  await db.update(users).set({ referredByUserId: referrerId }).where(eq(users.id, payer.id));
}
