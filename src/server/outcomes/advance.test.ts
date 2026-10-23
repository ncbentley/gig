import { describe, expect, it } from "vitest";
import { evaluateSignal, type EngineSignal } from "./engine";
import { checkpointToResume, signalsToAdvance } from "./service";

describe("signalsToAdvance", () => {
  it("returns the open signal and the pending signal the bar overlaps", () => {
    const bar = { t: 0, h: 100, l: 99 };
    const ids = signalsToAdvance(
      [
        { id: "open", status: "ACTIVE", entryMin: 90, entryMax: 91, entryType: "ZONE" },
        { id: "hit", status: "PENDING", entryMin: 99, entryMax: 100, entryType: "ZONE" },
        { id: "miss", status: "PENDING", entryMin: 120, entryMax: 121, entryType: "ZONE" },
        { id: "done", status: "WON", entryMin: 99, entryMax: 100, entryType: "ZONE" },
      ],
      bar,
    );
    expect(ids).toEqual(["open", "hit"]);
  });
});

describe("checkpointToResume", () => {
  const call = Date.UTC(2026, 9, 23, 6, 35);
  const signal: EngineSignal = {
    direction: "SHORT",
    entryType: "LIMIT",
    entryMin: 4016,
    entryMax: 4016,
    stopLoss: 4127,
    targets: [4011],
    signalTime: call,
    expiryTime: null,
  };

  it("refuses a blank checkpoint and a checkpoint recorded on an older signal version", () => {
    const blank = evaluateSignal(signal, [], [], call);
    expect(checkpointToResume(blank.checkpoint, call, 2, 2)).toBeNull();
    const walked = evaluateSignal(signal, [{ t: call, o: 4015, h: 4016, l: 4014, c: 4016 }], [], call + 60_000);
    expect(checkpointToResume(walked.checkpoint, call, 2, 1)).toBeNull();
    expect(checkpointToResume(walked.checkpoint, call, 2, 2)).toBe(walked.checkpoint);
  });
});
