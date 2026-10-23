import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { gigActivityEvents, jobs, users } from "@/server/db/schema";
import { createMemberAccount } from "./register";

beforeAll(async () => {
  await runMigrations();
}, 60_000);

afterEach(() => {
  delete process.env.AETHERION_GIG_ACTIVITY_KEY;
});

afterAll(async () => {
  await closeDb();
});

describe("createMemberAccount", () => {
  it("writes signup:<userId> in the same transaction and does not enqueue without a key", async () => {
    delete process.env.AETHERION_GIG_ACTIVITY_KEY;
    const email = `signup-${crypto.randomUUID()}@example.com`;
    const user = await createMemberAccount({ email, passwordHash: "x" });
    const db = await getDb();
    const [row] = await db.select().from(gigActivityEvents).where(eq(gigActivityEvents.id, `signup:${user.id}`));
    expect(row).toMatchObject({ kind: "signup", status: "pending" });
    expect(row.occurredAt.getTime()).toBe(user.createdAt.getTime());
    const queued = await db.select().from(jobs).where(eq(jobs.dedupeKey, `gig-activity:signup:${user.id}`));
    expect(queued).toEqual([]);
    await db.delete(gigActivityEvents).where(eq(gigActivityEvents.id, row.id));
    await db.delete(users).where(eq(users.id, user.id));
  });

  it("enqueues GIG_ACTIVITY when the key is present", async () => {
    process.env.AETHERION_GIG_ACTIVITY_KEY = "a".repeat(64);
    const email = `signup-${crypto.randomUUID()}@example.com`;
    const user = await createMemberAccount({ email, passwordHash: "x" });
    const db = await getDb();
    const [job] = await db.select().from(jobs).where(eq(jobs.dedupeKey, `gig-activity:signup:${user.id}`));
    expect(job?.type).toBe("GIG_ACTIVITY");
    await db.delete(jobs).where(eq(jobs.id, job.id));
    await db.delete(gigActivityEvents).where(eq(gigActivityEvents.id, `signup:${user.id}`));
    await db.delete(users).where(eq(users.id, user.id));
  });
});
