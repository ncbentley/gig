import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/server/db";
import { complimentaryGrants, users } from "@/server/db/schema";
import { createReferralCode } from "./code";

function isDuplicateCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("unique") || message.includes("duplicate");
}

/** Gives the account a referral code when it does not have one yet. */
export async function ensureReferralCode(userId: string) {
  const db = await getDb();
  const [existing] = await db.select({ referralCode: users.referralCode }).from(users).where(eq(users.id, userId)).limit(1);
  if (!existing || existing.referralCode) return existing?.referralCode ?? null;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = createReferralCode();
    try {
      const [row] = await db
        .update(users)
        .set({ referralCode: code })
        .where(and(eq(users.id, userId), isNull(users.referralCode)))
        .returning({ referralCode: users.referralCode });
      if (row?.referralCode) return row.referralCode;
      const [again] = await db.select({ referralCode: users.referralCode }).from(users).where(eq(users.id, userId)).limit(1);
      return again?.referralCode ?? null;
    } catch (error) {
      if (!isDuplicateCode(error)) throw error;
    }
  }
  throw new Error("Could not assign a unique referral code");
}

/** Complimentary members never pay a monthly invoice, so payment recording never assigns their code. */
export async function ensureComplimentaryReferralCodes() {
  const db = await getDb();
  const rows = await db
    .select({ userId: complimentaryGrants.userId })
    .from(complimentaryGrants)
    .innerJoin(users, eq(users.id, complimentaryGrants.userId))
    .where(isNull(users.referralCode));
  for (const row of rows) await ensureReferralCode(row.userId);
  return rows.length;
}
