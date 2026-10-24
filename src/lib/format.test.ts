import { describe, expect, it } from "vitest";
import { fmtDateTime, fmtMinutes } from "./format";

describe("fmtMinutes", () => {
  it("carries 60 minutes into the next hour", () => {
    expect(fmtMinutes(0)).toBe("0m");
    expect(fmtMinutes(59)).toBe("59m");
    expect(fmtMinutes(59.6)).toBe("1h");
    expect(fmtMinutes(60)).toBe("1h");
    expect(fmtMinutes(61)).toBe("1h 1m");
    expect(fmtMinutes(119)).toBe("1h 59m");
    expect(fmtMinutes(119.6)).toBe("2h");
    expect(fmtMinutes(120)).toBe("2h");
  });

  it("does not render 6h 60m", () => {
    expect(fmtMinutes(419.6)).toBe("7h");
    expect(fmtMinutes(6 * 60 + 60)).toBe("7h");
  });
});

describe("fmtDateTime", () => {
  it("shows the year and UTC", () => {
    expect(fmtDateTime("2026-10-23T02:30:12Z")).toBe("23 Oct 2026, 02:30 UTC");
    expect(fmtDateTime("2025-10-08T02:26:00Z")).toBe("08 Oct 2025, 02:26 UTC");
  });
});
