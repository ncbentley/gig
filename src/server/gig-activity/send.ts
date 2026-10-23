import { createHmac } from "node:crypto";

export const GIG_ACTIVITY_URL = "https://book.aetherionnetwork.com/book/gig-activity";
export const GIG_ACTIVITY_KEY_RE = /^[a-f0-9]{64}$/;
export const GIG_ACTIVITY_ID_RE = /^[A-Za-z0-9:_-]{3,160}$/;

export type GigActivityKind = "signup" | "paid_membership";
export type GigActivityPayload = { id: string; kind: GigActivityKind; occurred_at: number };
export type GigActivityReceipt = { accepted: true; duplicate: boolean };

export type GigActivityFailureCode =
  | "missing_key"
  | "timeout"
  | "challenge"
  | "http_400"
  | "http_403"
  | "http_5xx"
  | "not_accepted";

export class GigActivityDeliveryError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code: GigActivityFailureCode,
  ) {
    super(message);
    this.name = "GigActivityDeliveryError";
  }
}

type SenderFetcher = (
  url: string,
  options: {
    method: "POST";
    redirect: "error";
    signal: AbortSignal;
    headers: { "Content-Type": string; "X-Gig-Timestamp": string; "X-Gig-Signature": string };
    body: string;
  },
) => Promise<{ ok: boolean; status: number; headers: Headers; json: () => Promise<unknown> }>;

export function hasGigActivityKey(key = process.env.AETHERION_GIG_ACTIVITY_KEY): key is string {
  return typeof key === "string" && GIG_ACTIVITY_KEY_RE.test(key);
}

export async function sendGigEvent(
  event: GigActivityPayload,
  {
    key = process.env.AETHERION_GIG_ACTIVITY_KEY,
    fetcher = fetch as SenderFetcher,
  }: { key?: string; fetcher?: SenderFetcher } = {},
): Promise<GigActivityReceipt> {
  if (!hasGigActivityKey(key)) throw new GigActivityDeliveryError("Server signing key is missing", true, "missing_key");
  if (event.kind !== "signup" && event.kind !== "paid_membership") {
    throw new Error("Invalid event kind");
  }
  if (!GIG_ACTIVITY_ID_RE.test(event.id)) throw new Error("Use a stable, opaque event ID");
  if (!Number.isFinite(event.occurred_at)) throw new Error("occurred_at must be Unix seconds");
  const body = JSON.stringify({ id: event.id, kind: event.kind, occurred_at: event.occurred_at });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", key).update(`${timestamp}.${body}`).digest("hex");
  let response: { ok: boolean; status: number; headers: Headers; json: () => Promise<unknown> };
  try {
    response = await fetcher(GIG_ACTIVITY_URL, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        "Content-Type": "application/json",
        "X-Gig-Timestamp": timestamp,
        "X-Gig-Signature": signature,
      },
      body,
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new GigActivityDeliveryError("Activity delivery timed out", true, "timeout");
    }
    throw new GigActivityDeliveryError("Activity delivery network error", true, "http_5xx");
  }
  if (response.status === 400) throw new GigActivityDeliveryError("Activity delivery HTTP 400", false, "http_400");
  if (response.status === 403) throw new GigActivityDeliveryError("Activity delivery HTTP 403", false, "http_403");
  if (!response.ok) throw new GigActivityDeliveryError(`Activity delivery HTTP ${response.status}`, true, "http_5xx");
  if (!(response.headers.get("content-type") || "").includes("application/json")) {
    throw new GigActivityDeliveryError("Unexpected response; check Cloudflare challenge", true, "challenge");
  }
  const result = (await response.json()) as { accepted?: boolean; duplicate?: boolean };
  if (result.accepted !== true) throw new GigActivityDeliveryError("Activity receipt not accepted", true, "not_accepted");
  return { accepted: true, duplicate: result.duplicate === true };
}
