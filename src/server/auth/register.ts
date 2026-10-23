import { getDb } from "@/server/db";
import { users } from "@/server/db/schema";
import { enqueueGigActivity } from "@/server/gig-activity/deliver";
import { recordGigActivityEvent } from "@/server/gig-activity/outbox";

export async function createMemberAccount(input: {
  email: string;
  passwordHash: string;
  referredByUserId?: string | null;
}) {
  const db = await getDb();
  const user = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(users)
      .values({
        email: input.email,
        passwordHash: input.passwordHash,
        referredByUserId: input.referredByUserId ?? undefined,
      })
      .returning();
    await recordGigActivityEvent(
      { id: `signup:${row.id}`, kind: "signup", occurredAt: row.createdAt },
      tx,
    );
    return row;
  });
  await enqueueGigActivity(`signup:${user.id}`);
  return user;
}
