import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import {
  consolidatedIdeas,
  goldBookEntries,
  marketDataSync,
  rawEvents,
  signalAdjustments,
  signalOutcomes,
  signalTargets,
  signals,
  sources,
} from "@/server/db/schema";
import { resetRateLimits } from "@/server/auth/rate-limit";
import { GET } from "./route";

const TOKEN = "test-research-feed-token";
const PUBLISHED = new Date("2026-02-03T09:00:00.000Z");
const RECEIVED = new Date("2026-02-03T09:00:05.000Z");
const EDITED = new Date("2026-02-03T10:00:00.000Z");

let normalId = "";
let cancelledId = "";
let qaId = "";
let ideaId = "";
let goldId = "";

function authed(url: string) {
  return new Request(url, { headers: { authorization: `Bearer ${TOKEN}` } });
}

beforeAll(async () => {
  process.env.RESEARCH_FEED_TOKEN = TOKEN;
  process.env.RESEARCH_FEED_RATE_LIMIT = "1000";
  await runMigrations();
  const db = await getDb();
  const [source] = await db
    .insert(sources)
    .values({ name: "Desk Alpha", slug: "desk-alpha", sourceType: "telegram", parserType: "text-generic", telegramAccessHash: "secret-hash" })
    .returning();
  const [qa] = await db
    .insert(sources)
    .values({ name: "QA Desk", slug: "qa-desk", sourceType: "telegram", parserType: "text-generic", isQa: true })
    .returning();
  const [origin] = await db
    .insert(rawEvents)
    .values({
      sourceId: source.id,
      externalMessageId: "n1",
      rawText: "XAUUSD BUY 3400 SL 3390 TP 3420",
      publishedAt: PUBLISHED,
      receivedAt: RECEIVED,
      contentHash: "research-normal",
    })
    .returning();
  const [cancelOrigin] = await db
    .insert(rawEvents)
    .values({
      sourceId: source.id,
      externalMessageId: "c1",
      rawText: "XAUUSD SELL 3410 SL 3420 TP 3390",
      publishedAt: PUBLISHED,
      receivedAt: RECEIVED,
      contentHash: "research-cancel",
    })
    .returning();
  const [qaOrigin] = await db
    .insert(rawEvents)
    .values({
      sourceId: qa.id,
      externalMessageId: "q1",
      rawText: "QA ONLY",
      publishedAt: PUBLISHED,
      receivedAt: RECEIVED,
      contentHash: "research-qa",
    })
    .returning();
  const [normal] = await db
    .insert(signals)
    .values({
      sourceId: source.id,
      originEventId: origin.id,
      direction: "LONG",
      entryType: "ZONE",
      entryMin: 3400,
      entryMax: 3402,
      stopLoss: 3390,
      signalTime: PUBLISHED,
      expiryTime: new Date("2026-02-03T15:00:00.000Z"),
      parserConfidence: 0.9,
      version: 1,
    })
    .returning();
  normalId = normal.id;
  const [cancelled] = await db
    .insert(signals)
    .values({
      sourceId: source.id,
      originEventId: cancelOrigin.id,
      direction: "SHORT",
      entryType: "MARKET",
      entryMin: 3410,
      entryMax: 3410,
      stopLoss: 3420,
      status: "PENDING",
      signalTime: PUBLISHED,
      parserConfidence: 0.9,
    })
    .returning();
  cancelledId = cancelled.id;
  const [qaSignal] = await db
    .insert(signals)
    .values({
      sourceId: qa.id,
      originEventId: qaOrigin.id,
      direction: "LONG",
      entryType: "MARKET",
      entryMin: 1,
      entryMax: 1,
      signalTime: PUBLISHED,
      parserConfidence: 1,
    })
    .returning();
  qaId = qaSignal.id;
  await db.insert(signalTargets).values([
    { signalId: normalId, targetIndex: 1, price: 3412, status: "OPEN" },
    { signalId: normalId, targetIndex: 2, price: 3425, status: "OPEN" },
  ]);
  await db.insert(signalOutcomes).values({
    signalId: normalId,
    calcVersion: "outcome-v6",
    signalVersion: 1,
    classification: "OPEN",
    entered: true,
    entryTime: PUBLISHED,
    entryPrice: 3400,
    ambiguous: false,
    detailJson: { rules: { version: "outcome-v6" } },
  });
  await db.insert(marketDataSync).values({
    instrument: "XAUUSD",
    provider: "twelvedata",
    syncedThrough: PUBLISHED,
  });
  await db.update(signals).set({ version: 2 }).where(eq(signals.id, normalId));
  await db.insert(signalAdjustments).values({
    signalId: normalId,
    rawEventId: origin.id,
    type: "EDIT",
    effectiveAt: EDITED,
    payloadJson: { entryMin: 3400 },
  });
  await db.update(signals).set({ status: "CANCELLED", closedAt: EDITED }).where(eq(signals.id, cancelledId));
  const [idea] = await db
    .insert(consolidatedIdeas)
    .values({
      direction: "LONG",
      entryMin: 3400,
      entryMax: 3402,
      stopLoss: 3390,
      targets: [3412, 3425],
      exitSpreadTargets: [],
      sourceCount: 4,
      signalIds: [normalId],
      replacedSignalIds: [],
      newestSignalAt: PUBLISHED,
    })
    .returning();
  ideaId = idea.id;
  const [gold] = await db
    .insert(goldBookEntries)
    .values({
      ideaId,
      direction: "LONG",
      entryMin: 3400,
      entryMax: 3402,
      stopLoss: 3390,
      targets: [3412],
    })
    .returning();
  goldId = gold.id;
  await db.delete(goldBookEntries).where(eq(goldBookEntries.id, goldId));
}, 60_000);

afterAll(async () => {
  delete process.env.RESEARCH_FEED_TOKEN;
  delete process.env.RESEARCH_FEED_RATE_LIMIT;
  await closeDb();
});

beforeEach(() => {
  resetRateLimits();
  process.env.RESEARCH_FEED_TOKEN = TOKEN;
  process.env.RESEARCH_FEED_RATE_LIMIT = "1000";
});

describe("GET /api/v1/research/feed", () => {
  it("stays closed until the read token is configured", async () => {
    delete process.env.RESEARCH_FEED_TOKEN;
    const res = await GET(authed("http://localhost/api/v1/research/feed"));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("research_feed_disabled");
  });

  it("rejects a missing, wrong, or revoked bearer", async () => {
    const missing = await GET(new Request("http://localhost/api/v1/research/feed"));
    expect(missing.status).toBe(401);
    const wrong = await GET(new Request("http://localhost/api/v1/research/feed", { headers: { authorization: "Bearer not-the-token" } }));
    expect(wrong.status).toBe(401);
    const body = await wrong.json();
    expect(body.error.code).toBe("invalid_token");
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("returns 429 with Retry-After after the budget is spent", async () => {
    process.env.RESEARCH_FEED_RATE_LIMIT = "1";
    const first = await GET(authed("http://localhost/api/v1/research/feed?limit=1"));
    expect(first.status).toBe(200);
    const second = await GET(authed("http://localhost/api/v1/research/feed?limit=1"));
    expect(second.status).toBe(429);
    expect(Number(second.headers.get("retry-after"))).toBeGreaterThan(0);
    const body = await second.json();
    expect(body.error.code).toBe("rate_limited");
  });

  it("pages with a stable cursor and repeats the same page for the same cursor", async () => {
    const first = await GET(authed("http://localhost/api/v1/research/feed?limit=1"));
    const again = await GET(authed("http://localhost/api/v1/research/feed?limit=1"));
    expect(first.status).toBe(200);
    const page = await first.json();
    const duplicate = await again.json();
    expect(duplicate.data.map((row: { seq: number }) => row.seq)).toEqual(page.data.map((row: { seq: number }) => row.seq));
    expect(page.page.nextCursor).toBeTruthy();
    const second = await GET(authed(`http://localhost/api/v1/research/feed?limit=1&cursor=${page.page.nextCursor}`));
    const next = await second.json();
    expect(next.data[0].seq).toBeGreaterThan(page.data[0].seq);
  });

  it("publishes basic, silver, and gold lineage without member or payment fields", async () => {
    const items = [];
    let cursor: string | null = null;
    for (let i = 0; i < 30; i++) {
      const url = new URL("http://localhost/api/v1/research/feed");
      url.searchParams.set("limit", "5");
      if (cursor) url.searchParams.set("cursor", cursor);
      const res = await GET(authed(url.toString()));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.schema).toBe("research-feed-v1");
      items.push(...body.data);
      cursor = body.page.nextCursor;
      if (!cursor) break;
    }
    const serialized = JSON.stringify(items);
    expect(serialized).not.toContain("secret-hash");
    expect(serialized).not.toContain("stripe");
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain(qaId);
    expect(serialized).not.toContain("sourceCount");
    expect(serialized).not.toContain("vote");

    const normal = items.filter((row) => row.id === normalId && row.op === "upsert");
    expect(normal.length).toBeGreaterThan(1);
    const edited = normal.find((row) => row.revision === "2");
    expect(edited).toMatchObject({
      tier: "basic",
      sourceType: "trader_call",
      lifecycle: "pending",
      status: "PENDING",
      direction: "LONG",
      orderType: "ZONE",
      publishedAt: "2026-02-03T09:00:00.000Z",
      editedAt: "2026-02-03T10:00:00.000Z",
      recordedAt: "2026-02-03T09:00:05.000Z",
      text: "XAUUSD BUY 3400 SL 3390 TP 3420",
      instrument: "XAUUSD",
      feed: null,
      source: { id: expect.any(String), displayName: "Desk Alpha" },
      entry: { min: 3400, max: 3402 },
      stopLoss: 3390,
      targets: [
        { index: 1, price: 3412 },
        { index: 2, price: 3425 },
      ],
      horizon: { expiryAt: "2026-02-03T15:00:00.000Z" },
      lineage: { signalIds: [normalId], ideaIds: [], replacedSignalIds: [] },
    });
    expect(edited.outcome).toMatchObject({
      methodologyVersion: "outcome-v6",
      marketDataSource: "twelvedata",
      resolution: "1m",
      spreadCostAssumption: null,
      sameBarStopTargetAmbiguous: false,
    });
    expect(edited.outcome.entryTriggerRule).toEqual(expect.any(String));

    const cancelled = items.filter((row) => row.id === cancelledId && row.op === "upsert").at(-1);
    expect(cancelled).toMatchObject({ status: "CANCELLED", lifecycle: "cancelled", publishedAt: "2026-02-03T09:00:00.000Z" });

    const idea = items.find((row) => row.id === ideaId && row.op === "upsert");
    expect(idea).toMatchObject({
      tier: "silver",
      sourceType: "grouped_idea",
      lineage: { signalIds: [normalId], ideaIds: [], replacedSignalIds: [] },
    });
    expect(idea.sourceCount).toBeUndefined();

    const tombstone = items.find((row) => row.id === goldId && row.op === "delete");
    expect(tombstone).toMatchObject({
      tier: "gold",
      sourceType: "gig_generated_analysis",
      deletedAt: expect.any(String),
      text: null,
      publishedAt: null,
    });
    const goldUpsert = items.find((row) => row.id === goldId && row.op === "upsert");
    expect(goldUpsert.lineage.ideaIds).toEqual([ideaId]);
    expect(goldUpsert.lineage.signalIds).toEqual([normalId]);
  });
});
