import { createHash, timingSafeEqual } from "node:crypto";

export function researchFeedToken() {
  const token = process.env.RESEARCH_FEED_TOKEN?.trim();
  return token ? token : null;
}

export function researchFeedBudget() {
  const n = Number(process.env.RESEARCH_FEED_RATE_LIMIT ?? 60);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 60;
}

/** Compares the bearer to the configured token without leaking the token or its length. */
export function bearerMatches(authorization: string | null, expected: string) {
  const given = authorization?.match(/^Bearer\s+(\S+)\s*$/i)?.[1] ?? null;
  if (!given) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
