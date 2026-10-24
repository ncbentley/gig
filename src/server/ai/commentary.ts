import { EXPECTANCY_MIN_RATED } from "@/server/statistics/compute";

export interface CommentaryEvidence {
  closedTrades: number;
  ratedTrades: number;
  stopSupplied: boolean;
  targetsSupplied: boolean;
  chronologyKind: "no_entry" | "aligned" | "minute_bar_rounding" | "quarantined" | "unknown";
}

/** Wording the narrative must use when the sample, the geometry, or the clock cannot support a performance claim. */
export function insufficientEvidence(input: CommentaryEvidence): string | null {
  const reasons: string[] = [];
  if (input.chronologyKind === "quarantined") reasons.push("the stored fill is before publication");
  if (input.chronologyKind === "unknown") reasons.push("publication time was not available to check the fill");
  if (!input.stopSupplied) reasons.push("no stop was supplied");
  if (!input.targetsSupplied) reasons.push("no targets were supplied");
  if (input.ratedTrades < EXPECTANCY_MIN_RATED) {
    reasons.push(`known R is ${input.ratedTrades}, and expectancy uses samples of at least ${EXPECTANCY_MIN_RATED}`);
  }
  if (!reasons.length) return null;
  return `Insufficient evidence: ${reasons.join("; ")}.`;
}
