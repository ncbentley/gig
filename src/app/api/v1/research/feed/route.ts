import { apiError, json } from "@/server/api";
import { rateLimit } from "@/server/auth/rate-limit";
import { RESEARCH_FEED_PAGE_MAX, RESEARCH_FEED_WINDOW_MS, readResearchFeed } from "@/server/research/feed";
import { bearerMatches, researchFeedBudget, researchFeedToken } from "@/server/research/token";

export async function GET(req: Request) {
  const expected = researchFeedToken();
  if (!expected) return apiError(503, "research_feed_disabled", "RESEARCH_FEED_TOKEN is not configured.");
  if (!bearerMatches(req.headers.get("authorization"), expected)) {
    return apiError(401, "invalid_token", "Missing or invalid research feed token.");
  }

  const budget = researchFeedBudget();
  const limitResult = rateLimit("research-feed", budget, RESEARCH_FEED_WINDOW_MS);
  if (!limitResult.ok) {
    const retryAfter = Math.max(1, Math.ceil((limitResult.resetAt - Date.now()) / 1000));
    const res = apiError(429, "rate_limited", "Too many research feed requests.", { retryAfterSeconds: retryAfter });
    res.headers.set("retry-after", String(retryAfter));
    res.headers.set("x-ratelimit-limit", String(budget));
    res.headers.set("x-ratelimit-remaining", "0");
    return res;
  }

  const params = new URL(req.url).searchParams;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > RESEARCH_FEED_PAGE_MAX) {
    return apiError(400, "invalid_limit", `limit must be an integer from 1 to ${RESEARCH_FEED_PAGE_MAX}.`);
  }
  const rawCursor = params.get("cursor");
  if (rawCursor !== null && !/^\d+$/.test(rawCursor)) return apiError(400, "invalid_cursor", "cursor must be a decimal sequence number.");
  const cursor = rawCursor === null ? 0 : Number(rawCursor);

  const body = await readResearchFeed(cursor, limit);
  const res = json(body);
  res.headers.set("x-ratelimit-limit", String(budget));
  res.headers.set("x-ratelimit-remaining", String(limitResult.remaining));
  return res;
}
