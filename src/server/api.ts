import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { userFromSessionToken } from "@/server/auth";
import { getViewer, viewerForUser, type Viewer } from "@/server/entitlements/service";

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

export function apiError(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return json({ error: { code, message, ...extra } }, status);
}

/** Bearer scheme, case-insensitive, with a single token after it. Anything else is not a bearer. */
function bearerToken(authorization: string | null): string | null {
  return authorization?.match(/^Bearer\s+(\S+)\s*$/i)?.[1] ?? null;
}

/** Resolves the session viewer for API routes; unauthenticated callers get 401. */
export async function withViewer(fn: (viewer: Viewer) => Promise<Response>): Promise<Response> {
  const token = bearerToken((await headers()).get("authorization"));
  if (token !== null) {
    const user = await userFromSessionToken(token);
    if (!user) return apiError(401, "unauthenticated", "Sign in to use the API.");
    return fn(await viewerForUser(user));
  }
  const viewer = await getViewer();
  if (!viewer.user) return apiError(401, "unauthenticated", "Sign in to use the API.");
  return fn(viewer);
}

export function accessPayload(viewer: Viewer) {
  return {
    tier: viewer.access.tier,
    isAdmin: viewer.access.isAdmin,
    historyDays: viewer.access.historyDays,
    features: [...viewer.access.features].sort(),
  };
}
