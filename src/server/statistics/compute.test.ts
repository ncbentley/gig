import { describe, expect, it } from "vitest";
import { computeSourceStatistics, expectancyEligible, type StatsInputRow } from "./compute";

function row(overrides: Partial<StatsInputRow> = {}): StatsInputRow {
  return {
    signalId: "s",
    direction: "LONG",
    entryType: "MARKET",
    signalType: null,
    signalTime: new Date("2026-10-01T00:00:00Z"),
    classification: "WON",
    entered: true,
    rResult: null,
    mfe: null,
    mae: null,
    mfeR: null,
    maeR: null,
    durationMinutes: 30,
    targetMinutes: [],
    ...overrides,
  };
}

describe("source statistic denominators", () => {
  it("does not rank expectancy from one known R among 35 price wins", () => {
    const rows = [
      row({ signalId: "rated", rResult: 0.96 }),
      ...Array.from({ length: 34 }, (_, i) => row({ signalId: `plain-${i}`, rResult: null })),
    ];
    const stats = computeSourceStatistics(rows);
    expect(stats.closedTrades).toBe(35);
    expect(stats.wins).toBe(35);
    expect(stats.winRate).toBe(1);
    expect(stats.ratedTrades).toBe(1);
    expect(stats.unknownR).toBe(34);
    expect(stats.knownRCoverage).toBe(0.03);
    expect(stats.expectancy).toBe(0.96);
    expect(expectancyEligible(stats)).toBe(false);
  });

  it("leaves a quarantined win out of the closed and known-R counts", () => {
    const stats = computeSourceStatistics([
      row({ signalId: "bad", rResult: 2, chronologyQuarantined: true }),
      // Outcome engine stores loss R already signed. The LOST label must not flip it again.
      row({ signalId: "ok", rResult: -1, classification: "LOST" }),
    ]);
    expect(stats.chronologyQuarantined).toBe(1);
    expect(stats.closedTrades).toBe(1);
    expect(stats.wins).toBe(0);
    expect(stats.losses).toBe(1);
    expect(stats.ratedTrades).toBe(1);
    expect(stats.expectancy).toBe(-1);
  });

  it("keeps a stored positive R on a LOST row instead of flipping the sign from the label", () => {
    const stats = computeSourceStatistics([
      row({ signalId: "mismatch", rResult: 1, classification: "LOST" }),
    ]);
    expect(stats.losses).toBe(1);
    expect(stats.expectancy).toBe(1);
    expect(stats.avgR).toBe(1);
  });

  it("does not turn a sample with no known R into 0R expectancy", () => {
    const stats = computeSourceStatistics([row({ rResult: null })]);
    expect(stats.expectancy).toBeNull();
    expect(stats.avgR).toBeNull();
    expect(stats.unknownR).toBe(1);
  });
});
