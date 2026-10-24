/** Stable labels for missing or unusable trade evidence. There is no public methodology page to link. */

export const EVIDENCE = {
  noStop: "No stop supplied",
  noTargets: "No targets supplied",
  rUnavailable: "R unavailable",
  costUnknown: "Cost assumption unknown",
  ambiguousMinute: "Ambiguous minute",
  entryBeforePublication: "Entry before publication",
  minuteBarRounding: "Minute-bar rounding",
} as const;

export function evidenceLabels(input: {
  stopSupplied: boolean;
  targetsSupplied: boolean;
  /** Closed, or otherwise a row someone might read as a finished R. */
  rKnown: boolean;
  ambiguous: boolean;
  chronologyKind?: "no_entry" | "aligned" | "minute_bar_rounding" | "quarantined" | null;
  costKnown?: boolean;
}): string[] {
  const labels: string[] = [];
  if (!input.stopSupplied) labels.push(EVIDENCE.noStop);
  if (!input.targetsSupplied) labels.push(EVIDENCE.noTargets);
  if (!input.rKnown || input.chronologyKind === "quarantined" || !input.stopSupplied) labels.push(EVIDENCE.rUnavailable);
  if (input.costKnown !== true) labels.push(EVIDENCE.costUnknown);
  if (input.ambiguous) labels.push(EVIDENCE.ambiguousMinute);
  if (input.chronologyKind === "quarantined") labels.push(EVIDENCE.entryBeforePublication);
  if (input.chronologyKind === "minute_bar_rounding") labels.push(EVIDENCE.minuteBarRounding);
  return [...new Set(labels)];
}
