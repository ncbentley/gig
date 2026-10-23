import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { gigActivityEvents } from "@/server/db/schema";
import { getGigActivityEvent, markGigActivityError, markGigActivitySent, recordGigActivityEvent } from "./outbox";

beforeAll(async () => {
  await runMigrations();
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("recordGigActivityEvent", () => {
  it("inserts once and treats a second insert of the same id as a no-op", async () => {
    const id = `signup:${crypto.randomUUID()}`;
    const occurredAt = new Date("2026-01-15T12:00:00.000Z");
    const first = await recordGigActivityEvent({ id, kind: "signup", occurredAt });
    const second = await recordGigActivityEvent({ id, kind: "signup", occurredAt });
    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);

    const row = await getGigActivityEvent(id);
    expect(row).toMatchObject({ id, kind: "signup", status: "pending" });
    expect(row?.occurredAt.toISOString()).toBe(occurredAt.toISOString());

    await markGigActivitySent(id);
    expect((await getGigActivityEvent(id))?.status).toBe("sent");

    await recordGigActivityEvent({ id, kind: "signup", occurredAt });
    expect((await getGigActivityEvent(id))?.status).toBe("sent");

    const other = `paid:${crypto.randomUUID()}`;
    await recordGigActivityEvent({ id: other, kind: "paid_membership", occurredAt });
    await markGigActivityError(other, "http_400");
    expect((await getGigActivityEvent(other))?.lastError).toBe("http_400");
    expect((await getGigActivityEvent(other))?.status).toBe("pending");

    const db = await getDb();
    await db.delete(gigActivityEvents).where(eq(gigActivityEvents.id, id));
    await db.delete(gigActivityEvents).where(eq(gigActivityEvents.id, other));
  });
});
