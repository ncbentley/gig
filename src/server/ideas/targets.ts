/**
 * Silver grouping stores one price per target slot: the mean of the prices sources
 * supplied for that slot. That array is the replay ladder. It is not reordered.
 * Contributed targets stay as each source published them, including duplicates.
 */

export interface ContributedTargets {
  signalId: string;
  prices: number[];
}

export function replayLadderNonMonotonic(direction: "LONG" | "SHORT", prices: number[]) {
  for (let i = 1; i < prices.length; i++) {
    if (direction === "LONG" && prices[i] < prices[i - 1]) return true;
    if (direction === "SHORT" && prices[i] > prices[i - 1]) return true;
  }
  return false;
}

export function describeTargetLadders(input: {
  direction: "LONG" | "SHORT";
  replayTargets: number[];
  contributed: ContributedTargets[];
}) {
  return {
    replayTargets: input.replayTargets,
    contributedTargets: input.contributed,
    replayNonMonotonic: replayLadderNonMonotonic(input.direction, input.replayTargets),
    aggregation:
      "Each stop and each target slot is the mean of the values sources supplied for that slot. A source with no stop is left out of the stop mean. A missing slot is left out of that slot. Sources that supplied the slot are weighted equally by that mean.",
    note: "Replay uses the stored slot means in stored order. That order is not sorted and is not a promise that each next target is further along. Contributed targets are the source prices in target-index order.",
  };
}
