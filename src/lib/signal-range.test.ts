import { describe, expect, it } from "vitest";
import { dateRangeError } from "./signal-range";

describe("dateRangeError", () => {
  it("accepts an empty or ordered range", () => {
    expect(dateRangeError("", "")).toBeNull();
    expect(dateRangeError("2026-10-01", "2026-10-23")).toBeNull();
    expect(dateRangeError("2026-10-23", null)).toBeNull();
  });

  it("explains a reversed range", () => {
    expect(dateRangeError("2026-10-23", "2026-10-01")).toMatch(/From is after To/);
  });

  it("explains an invalid date", () => {
    expect(dateRangeError("not-a-date", "2026-10-01")).toMatch(/From is not a valid date/);
  });
});
