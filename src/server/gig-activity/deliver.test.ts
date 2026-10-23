import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { gigActivityEvents, jobs } from "@/server/db/schema";
import { enqueueJob } from "@/server/jobs/queue";
import { processJobs } from "@/server/jobs/runner";
import {
  enqueueGigActivity,
  enqueuePendingGigActivity,
  reportLivePaidMembership,
  useGigActivitySender,
} from "./deliver";
import { GigActivityDeliveryError } from "./send";
import { recordGigActivityEvent } from "./outbox";

process.env.JOBS_WORKER = "off";

beforeAll(async () => {
  await runMigrations();
}, 60_000);

afterEach(() => {
  useGigActivitySender(null);
  delete process.env.AETHERION_GIG_ACTIVITY_KEY;
});

afterAll(async () => {
  await closeDb();
});

async function cleanup(id: string) {
  const db = await getDb();
  await db.delete(jobs).where(eq(jobs.dedupeKey, `gig-activity:${id}`));
  await db.delete(gigActivityEvents).where(eq(gigActivityEvents.id, id));
}

describe("GIG_ACTIVITY job", () => {
  it("marks the outbox sent on accepted and on duplicate", async () => {
    process.env.AETHERION_GIG_ACTIVITY_KEY = "a".repeat(64);
    const id = `signup:${crypto.randomUUID()}`;
    await recordGigActivityEvent({ id, kind: "signup", occurredAt: new Date("2026-01-15T12:00:00.000Z") });
    useGigActivitySender(async () => ({ accepted: true, duplicate: false }));
    await enqueueJob("GIG_ACTIVITY", { eventId: id }, { dedupeKey: `gig-activity:${id}`, maxAttempts: 12 });
    await processJobs(5, ["GIG_ACTIVITY"]);
    const db = await getDb();
    const [row] = await db.select().from(gigActivityEvents).where(eq(gigActivityEvents.id, id));
    expect(row.status).toBe("sent");

    const id2 = `signup:${crypto.randomUUID()}`;
    await recordGigActivityEvent({ id: id2, kind: "signup", occurredAt: new Date("2026-01-15T12:00:00.000Z") });
    useGigActivitySender(async () => ({ accepted: true, duplicate: true }));
    await enqueueJob("GIG_ACTIVITY", { eventId: id2 }, { dedupeKey: `gig-activity:${id2}`, maxAttempts: 12 });
    await processJobs(5, ["GIG_ACTIVITY"]);
    const [dup] = await db.select().from(gigActivityEvents).where(eq(gigActivityEvents.id, id2));
    expect(dup.status).toBe("sent");
    await cleanup(id);
    await cleanup(id2);
  });

  it("requeues on 500 and fails without retry on 400", async () => {
    process.env.AETHERION_GIG_ACTIVITY_KEY = "a".repeat(64);
    const retryId = `signup:${crypto.randomUUID()}`;
    const failId = `signup:${crypto.randomUUID()}`;
    await recordGigActivityEvent({ id: retryId, kind: "signup", occurredAt: new Date() });
    await recordGigActivityEvent({ id: failId, kind: "signup", occurredAt: new Date() });

    useGigActivitySender(async () => {
      throw new GigActivityDeliveryError("Activity delivery HTTP 500", true, "http_5xx");
    });
    await enqueueJob("GIG_ACTIVITY", { eventId: retryId }, { dedupeKey: `gig-activity:${retryId}`, maxAttempts: 12 });
    await processJobs(5, ["GIG_ACTIVITY"]);
    const db = await getDb();
    const [retried] = await db.select().from(jobs).where(eq(jobs.dedupeKey, `gig-activity:${retryId}`));
    const [pending] = await db.select().from(gigActivityEvents).where(eq(gigActivityEvents.id, retryId));
    expect(retried.status).toBe("queued");
    expect(pending.status).toBe("pending");
    expect(pending.lastError).toBe("http_5xx");

    useGigActivitySender(async () => {
      throw new GigActivityDeliveryError("Activity delivery HTTP 400", false, "http_400");
    });
    await enqueueJob("GIG_ACTIVITY", { eventId: failId }, { dedupeKey: `gig-activity:${failId}`, maxAttempts: 12 });
    await processJobs(5, ["GIG_ACTIVITY"]);
    const [failed] = await db.select().from(jobs).where(eq(jobs.dedupeKey, `gig-activity:${failId}`));
    const [still] = await db.select().from(gigActivityEvents).where(eq(gigActivityEvents.id, failId));
    expect(failed.status).toBe("failed");
    expect(still.status).toBe("pending");
    expect(still.lastError).toBe("http_400");
    await cleanup(retryId);
    await cleanup(failId);
  });
});

describe("enqueueGigActivity", () => {
  it("does not enqueue without a valid key, and the sweep enqueues pending rows when the key is present", async () => {
    delete process.env.AETHERION_GIG_ACTIVITY_KEY;
    const id = `signup:${crypto.randomUUID()}`;
    await recordGigActivityEvent({ id, kind: "signup", occurredAt: new Date() });
    expect(await enqueueGigActivity(id)).toBeNull();
    expect(await enqueuePendingGigActivity()).toEqual([]);

    process.env.AETHERION_GIG_ACTIVITY_KEY = "a".repeat(64);
    const queued = await enqueuePendingGigActivity();
    expect(queued).toContain(id);
    const db = await getDb();
    const [job] = await db.select().from(jobs).where(eq(jobs.dedupeKey, `gig-activity:${id}`));
    expect(job?.type).toBe("GIG_ACTIVITY");
    expect(job?.maxAttempts).toBe(12);
    await cleanup(id);
  });

  it("does not enqueue another job after a 400, and still sweeps 5xx pending rows", async () => {
    process.env.AETHERION_GIG_ACTIVITY_KEY = "a".repeat(64);
    const failId = `signup:${crypto.randomUUID()}`;
    const retryId = `signup:${crypto.randomUUID()}`;
    const exhaustedId = `signup:${crypto.randomUUID()}`;
    await recordGigActivityEvent({ id: failId, kind: "signup", occurredAt: new Date() });
    await recordGigActivityEvent({ id: retryId, kind: "signup", occurredAt: new Date() });
    await recordGigActivityEvent({ id: exhaustedId, kind: "signup", occurredAt: new Date() });

    useGigActivitySender(async (event) => {
      if (event.id === failId) throw new GigActivityDeliveryError("Activity delivery HTTP 400", false, "http_400");
      throw new GigActivityDeliveryError("Activity delivery HTTP 500", true, "http_5xx");
    });
    await enqueueJob("GIG_ACTIVITY", { eventId: failId }, { dedupeKey: `gig-activity:${failId}`, maxAttempts: 12 });
    await enqueueJob("GIG_ACTIVITY", { eventId: retryId }, { dedupeKey: `gig-activity:${retryId}`, maxAttempts: 12 });
    await enqueueJob("GIG_ACTIVITY", { eventId: exhaustedId }, { dedupeKey: `gig-activity:${exhaustedId}`, maxAttempts: 1 });
    await processJobs(10, ["GIG_ACTIVITY"]);

    const db = await getDb();
    const before = await db.select().from(jobs).where(eq(jobs.dedupeKey, `gig-activity:${failId}`));
    expect(before).toHaveLength(1);
    expect(before[0].status).toBe("failed");

    const queued = await enqueuePendingGigActivity();
    expect(queued).not.toContain(failId);
    expect(queued).toContain(retryId);
    expect(queued).toContain(exhaustedId);
    expect(await db.select().from(jobs).where(eq(jobs.dedupeKey, `gig-activity:${failId}`))).toHaveLength(1);
    const exhaustedJobs = await db.select().from(jobs).where(eq(jobs.dedupeKey, `gig-activity:${exhaustedId}`));
    expect(exhaustedJobs.some((job) => job.status === "queued")).toBe(true);

    await cleanup(failId);
    await cleanup(retryId);
    await cleanup(exhaustedId);
  });
});

describe("reportLivePaidMembership", () => {
  it("writes only when livemode is true", async () => {
    const liveId = `paid:${crypto.randomUUID()}`;
    const testId = `paid:${crypto.randomUUID()}`;
    const occurredAt = new Date("2026-01-15T12:00:00.000Z");
    expect(await reportLivePaidMembership({ livemode: false, membershipId: testId, occurredAt })).toEqual({
      recorded: false,
    });
    expect(await reportLivePaidMembership({ livemode: true, membershipId: liveId, occurredAt })).toEqual({
      recorded: true,
    });
    const db = await getDb();
    expect(await db.select().from(gigActivityEvents).where(eq(gigActivityEvents.id, testId))).toEqual([]);
    const [row] = await db.select().from(gigActivityEvents).where(eq(gigActivityEvents.id, liveId));
    expect(row.kind).toBe("paid_membership");
    await cleanup(liveId);
  });
});
