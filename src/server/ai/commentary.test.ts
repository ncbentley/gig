import { describe, expect, it } from "vitest";
import { insufficientEvidence } from "./commentary";
import type { SignalFacts, SourcePatternFacts } from "./facts";
import { mockAiProvider } from "./providers/mock";

const sparse: SignalFacts = {
  signal: {
    sourceName: "this source",
    direction: "LONG",
    entryType: "MARKET",
    entryMin: 4000,
    entryMax: 4000,
    stopLoss: null,
    targets: [],
    signalType: null,
    signalTimeUtc: "2026-10-23T02:30:12Z",
    session: "Asia",
    dayOfWeek: "Friday",
  },
  geometry: { riskUsd: null, rewardRiskTp1: null, rewardRiskLast: null, zoneWidth: 0 },
  marketContext: { priceAtSignal: null, change60m: null, change240m: null, range240m: null, avgBarRange60m: null, volatilityRatio: null },
  sourceHistory: {
    closedTrades: 35,
    ratedTrades: 1,
    unknownR: 34,
    winRate: 1,
    avgR: 0.96,
    expectancy: 0.96,
    sameSession: null,
    sameDirection: null,
  },
  similar: { n: 0, winRate: null, avgR: null, dimensions: [] },
  evidence: { closedTrades: 35, ratedTrades: 1, stopSupplied: false, targetsSupplied: false, chronologyKind: "quarantined" },
  outcome: { classification: "WON", rResult: 0.96, mfeR: 1, maeR: 0.1, durationMinutes: 10, exitReason: "TARGETS" },
};

describe("AI commentary constraints", () => {
  it("names the sparse sample instead of a strong return", () => {
    expect(insufficientEvidence(sparse.evidence)).toMatch(/Insufficient evidence/);
    expect(insufficientEvidence(sparse.evidence)).toMatch(/known R is 1/);
  });

  it("does not use the later win to justify the call", async () => {
    const output = (await mockAiProvider.generate({
      analysisType: "signal_setup",
      promptVersion: "signal-setup-v1",
      system: "",
      facts: sparse as unknown as Record<string, unknown>,
      jsonSchema: {},
    })) as { summary: string; setupClassification: { confidence: number; rationale: string } };
    expect(output.summary).toMatch(/Insufficient evidence/);
    expect(output.summary.toLowerCase()).not.toMatch(/strong|high average/);
    expect(output.summary).not.toMatch(/closed as won/i);
    expect(output.setupClassification.rationale).toMatch(/not a win probability/);
    expect(output.setupClassification.confidence).toBeLessThanOrEqual(0.4);
  });

  it("marks a one-R source pattern as insufficient for expectancy", async () => {
    const facts: SourcePatternFacts = {
      sourceName: "this source",
      closedTrades: 35,
      ratedTrades: 1,
      unknownR: 34,
      winRate: 1,
      avgR: 0.96,
      expectancy: 0.96,
      avgMfeR: null,
      avgMaeR: null,
      recent30: { n: 1, wins: 1, losses: 0, breakevens: 0, winRate: 1, avgR: 0.96, sumR: 0.96 },
      bySession: {},
      byDirection: {},
    };
    const output = (await mockAiProvider.generate({
      analysisType: "source_patterns",
      promptVersion: "source-patterns-v1",
      system: "",
      facts: facts as unknown as Record<string, unknown>,
      jsonSchema: {},
    })) as { headline: string; caveats: string[] };
    expect(output.headline.toLowerCase()).toMatch(/insufficient evidence/);
    expect(output.caveats.join(" ")).toMatch(/not counted as 0R/);
  });
});
