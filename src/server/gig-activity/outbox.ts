import { eq } from "drizzle-orm";
import { getDb } from "@/server/db";
import { gigActivityEvents, type GigActivityEvent } from "@/server/db/schema";
import type { GigActivityKind } from "./send";

type Executor = {
  insert: Awaited<ReturnType<typeof getDb>>["insert"];
  select: Awaited<ReturnType<typeof getDb>>["select"];
  update: Awaited<ReturnType<typeof getDb>>["update"];
};

export async function recordGigActivityEvent(
  input: { id: string; kind: GigActivityKind; occurredAt: Date },
  executor?: Executor,
): Promise<{ inserted: boolean }> {
  const db = executor ?? (await getDb());
  const [row] = await db
    .insert(gigActivityEvents)
    .values({
      id: input.id,
      kind: input.kind,
      occurredAt: input.occurredAt,
    })
    .onConflictDoNothing({ target: gigActivityEvents.id })
    .returning({ id: gigActivityEvents.id });
  return { inserted: Boolean(row) };
}

export async function getGigActivityEvent(id: string): Promise<GigActivityEvent | null> {
  const db = await getDb();
  const [row] = await db.select().from(gigActivityEvents).where(eq(gigActivityEvents.id, id)).limit(1);
  return row ?? null;
}

export async function listPendingGigActivityEvents(): Promise<GigActivityEvent[]> {
  const db = await getDb();
  return db.select().from(gigActivityEvents).where(eq(gigActivityEvents.status, "pending"));
}

export async function markGigActivitySent(id: string) {
  const db = await getDb();
  await db
    .update(gigActivityEvents)
    .set({ status: "sent", sentAt: new Date(), lastError: null })
    .where(eq(gigActivityEvents.id, id));
}

export async function markGigActivityError(id: string, code: string) {
  const db = await getDb();
  await db.update(gigActivityEvents).set({ lastError: code }).where(eq(gigActivityEvents.id, id));
}
