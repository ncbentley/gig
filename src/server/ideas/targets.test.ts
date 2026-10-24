import { describe, expect, it } from "vitest";
import { describeTargetLadders, replayLadderNonMonotonic } from "./targets";

const EXAMPLE = [3997.67, 3990, 3996, 3993, 3990];

describe("silver target ladders", () => {
  it("keeps the stored order of the non-monotonic example", () => {
    expect(replayLadderNonMonotonic("LONG", EXAMPLE)).toBe(true);
    expect(replayLadderNonMonotonic("SHORT", EXAMPLE)).toBe(true);
    const described = describeTargetLadders({
      direction: "SHORT",
      replayTargets: EXAMPLE,
      contributed: [
        { signalId: "a", prices: [3997.67, 3996] },
        { signalId: "b", prices: [3990, 3993, 3990] },
      ],
    });
    expect(described.replayTargets).toEqual(EXAMPLE);
    expect(described.contributedTargets[1].prices).toEqual([3990, 3993, 3990]);
    expect(described.replayNonMonotonic).toBe(true);
  });

  it("accepts a short ladder that steps down", () => {
    expect(replayLadderNonMonotonic("SHORT", [4000, 3990, 3980])).toBe(false);
  });
});
