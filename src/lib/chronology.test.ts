import { describe, expect, it } from "vitest";
import { assessChronology } from "./chronology";

describe("entry chronology", () => {
  it("quarantines the year-early fill from signal 000d4400", () => {
    const published = Date.parse("2026-10-23T02:30:12Z");
    const entry = Date.parse("2025-10-08T02:26:00Z");
    const assessed = assessChronology(published, entry);
    expect(assessed.kind).toBe("quarantined");
    expect(assessed.quarantined).toBe(true);
    expect(assessed.entryTimeMs).toBe(entry);
    expect(assessed.normalizedEntryTimeMs).toBeNull();
    expect(assessed.deltaMs).toBeLessThan(-24 * 60 * 60 * 1000);
  });

  it("quarantines the October 6 fill against an October 23 publication", () => {
    const published = Date.parse("2026-10-23T06:30:00Z");
    const entry = Date.parse("2026-10-06T03:39:00Z");
    const assessed = assessChronology(published, entry);
    expect(assessed.kind).toBe("quarantined");
    expect(assessed.normalizedEntryTimeMs).toBeNull();
    expect(assessed.entryTimeMs).toBe(entry);
  });

  it("keeps a fill under 60s early as minute-bar rounding", () => {
    const published = Date.parse("2026-10-23T02:30:12Z");
    const entry = published - 45_000;
    const assessed = assessChronology(published, entry);
    expect(assessed.kind).toBe("minute_bar_rounding");
    expect(assessed.quarantined).toBe(false);
    expect(assessed.normalizedEntryTimeMs).toBe(entry);
  });

  it("keeps a fill at or after publication", () => {
    const published = Date.parse("2026-10-23T02:30:12Z");
    expect(assessChronology(published, published).kind).toBe("aligned");
    expect(assessChronology(published, published + 60_000).normalizedEntryTimeMs).toBe(published + 60_000);
  });

  it("does not invent an entry", () => {
    expect(assessChronology(Date.parse("2026-10-23T02:30:12Z"), null).kind).toBe("no_entry");
  });

  it("quarantines a fill when publication is missing", () => {
    const entry = Date.parse("2026-10-23T02:31:00Z");
    const assessed = assessChronology(null, entry);
    expect(assessed.quarantined).toBe(true);
    expect(assessed.entryTimeMs).toBe(entry);
    expect(assessed.normalizedEntryTimeMs).toBeNull();
  });
});
