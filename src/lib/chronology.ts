/**
 * Chronology for a stored fill versus publication.
 *
 * Publication identity is the origin event's publishedAt (Telegram message date,
 * unix seconds converted with `new Date(seconds * 1000)` — the year is not stripped).
 * `signals.signalTime` is a copy of that instant at ingest. Replay uses signalTime.
 *
 * The outcome service loads bars from signalTime − 60s so the minute that contains
 * the call is available. `evaluateSignal` starts at `ceil(signalTime / 60s) * 60s`,
 * so a new fill's bar open is at or after the call. A checkpoint whose bar time is
 * still before that start is not resumed: an older walk must not become this trade.
 *
 * A bar open less than 60s before publication is minute-bar rounding, not a
 * year-scale error. An earlier entry is quarantined. Original timestamps stay.
 * The normalized entry is null while quarantined, so a win label on that row is
 * not treated as audited monetary evidence.
 */

export const MINUTE_BAR_MS = 60_000;

export type ChronologyKind = "no_entry" | "aligned" | "minute_bar_rounding" | "quarantined";

export interface ChronologyAssessment {
  kind: ChronologyKind;
  publishedAtMs: number | null;
  /** Original fill time. Never rewritten. */
  entryTimeMs: number | null;
  /** entry − published. Negative means the bar opens before publication. */
  deltaMs: number | null;
  quarantined: boolean;
  /** Null when there is no entry or the entry is quarantined. */
  normalizedEntryTimeMs: number | null;
}

export function assessChronology(publishedAtMs: number | null, entryTimeMs: number | null): ChronologyAssessment {
  if (entryTimeMs === null || !Number.isFinite(entryTimeMs)) {
    return {
      kind: "no_entry",
      publishedAtMs,
      entryTimeMs: null,
      deltaMs: null,
      quarantined: false,
      normalizedEntryTimeMs: null,
    };
  }
  if (publishedAtMs === null || !Number.isFinite(publishedAtMs)) {
    return {
      kind: "quarantined",
      publishedAtMs: null,
      entryTimeMs,
      deltaMs: null,
      quarantined: true,
      normalizedEntryTimeMs: null,
    };
  }
  const deltaMs = entryTimeMs - publishedAtMs;
  if (deltaMs >= 0) {
    return {
      kind: "aligned",
      publishedAtMs,
      entryTimeMs,
      deltaMs,
      quarantined: false,
      normalizedEntryTimeMs: entryTimeMs,
    };
  }
  if (deltaMs > -MINUTE_BAR_MS) {
    return {
      kind: "minute_bar_rounding",
      publishedAtMs,
      entryTimeMs,
      deltaMs,
      quarantined: false,
      normalizedEntryTimeMs: entryTimeMs,
    };
  }
  return {
    kind: "quarantined",
    publishedAtMs,
    entryTimeMs,
    deltaMs,
    quarantined: true,
    normalizedEntryTimeMs: null,
  };
}
