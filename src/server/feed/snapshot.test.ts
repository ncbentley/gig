import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@/server/db";
import { runMigrations } from "@/server/db/migrate";
import { dashboardSnapshots, feedRevisions } from "@/server/db/schema";
import { buildAccess } from "@/server/entitlements/access";
import { DEFAULT_TIER_CONFIG } from "@/server/entitlements/config";
import { applyHistoryWindow, syncDashboardCache, type DashboardCache } from "./snapshot";

describe("syncDashboardCache", () => {
  beforeAll(async () => {
    await runMigrations();
  }, 60_000);

  afterAll(async () => {
    await closeDb();
  });

  it("writes each dashboard once and leaves the cache alone when nothing changed", async () => {
    expect(await syncDashboardCache()).toBe(true);
    const db = await getDb();
    expect(await db.select().from(dashboardSnapshots)).toHaveLength(5);
    const [mark] = await db.select().from(feedRevisions).where(eq(feedRevisions.id, "dashboard"));
    expect(mark.fingerprint).toBeTruthy();
    expect(await syncDashboardCache()).toBe(false);
  });
});

describe("applyHistoryWindow", () => {
  it("drops cached rows that have aged out of the plan window", () => {
    const now = new Date("2026-10-16T12:00:00Z");
    const day = 86_400_000;
    const access = buildAccess("basic", DEFAULT_TIER_CONFIG);
    const cache = {
      spot: null,
      direction: null,
      ranking: { rows: [], eligibleCount: 0, sourceCount: 0 },
      signals: {
        open: [{ signalTime: new Date(now.getTime() - 8 * day).toISOString(), status: "ACTIVE" }],
        closed: [{ signalTime: new Date(now.getTime() - 2 * day).toISOString(), status: "WON" }],
        active: 1,
        pending: 0,
        total: 2,
        historyCount: 1,
      },
      ideas: {
        available: [{ newestSignalAt: new Date(now.getTime() - 8 * day).toISOString() }],
        active: [{ newestSignalAt: new Date(now.getTime() - 1 * day).toISOString() }],
        history: [{ newestSignalAt: new Date(now.getTime() - 3 * day).toISOString() }],
        historyCount: 4,
      },
      gold: null,
    } as unknown as DashboardCache;
    const next = applyHistoryWindow(cache, access, now);
    expect(next.signals?.open).toHaveLength(0);
    expect(next.signals?.closed).toHaveLength(1);
    expect(next.ideas?.available).toHaveLength(0);
    expect(next.ideas?.active).toHaveLength(1);
    expect(next.ideas?.history).toHaveLength(1);
    expect(next.ideas?.historyCount).toBe(4);
    expect(applyHistoryWindow(cache, buildAccess("gold", DEFAULT_TIER_CONFIG), now)).toBe(cache);
  });
});
