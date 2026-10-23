import { enqueueJob } from "@/server/jobs/queue";
import {
  getGigActivityEvent,
  listPendingGigActivityEvents,
  markGigActivityError,
  markGigActivitySent,
  recordGigActivityEvent,
} from "./outbox";
import {
  GigActivityDeliveryError,
  hasGigActivityKey,
  sendGigEvent,
  type GigActivityReceipt,
} from "./send";

type Sender = (event: { id: string; kind: "signup" | "paid_membership"; occurred_at: number }) => Promise<GigActivityReceipt>;

let sender: Sender | null = null;

export function useGigActivitySender(next: Sender | null) {
  sender = next;
}

export async function enqueueGigActivity(eventId: string) {
  if (!hasGigActivityKey()) return null;
  return enqueueJob("GIG_ACTIVITY", { eventId }, { dedupeKey: `gig-activity:${eventId}`, maxAttempts: 12 });
}

export async function enqueuePendingGigActivity() {
  if (!hasGigActivityKey()) return [];
  const pending = await listPendingGigActivityEvents();
  const ids: string[] = [];
  for (const row of pending) {
    if (row.lastError === "http_400" || row.lastError === "http_403") continue;
    await enqueueGigActivity(row.id);
    ids.push(row.id);
  }
  return ids;
}

export async function reportLivePaidMembership(input: {
  livemode: boolean;
  membershipId: string;
  occurredAt: Date;
}) {
  if (!input.livemode) return { recorded: false as const };
  await recordGigActivityEvent({
    id: input.membershipId,
    kind: "paid_membership",
    occurredAt: input.occurredAt,
  });
  await enqueueGigActivity(input.membershipId);
  return { recorded: true as const };
}

export async function runGigActivityJob(payload: Record<string, unknown>) {
  const eventId = String(payload.eventId ?? "");
  if (!eventId) return { skipped: "missing" };
  const row = await getGigActivityEvent(eventId);
  if (!row || row.status === "sent") return { skipped: row ? "already_sent" : "missing" };
  const send = sender ?? sendGigEvent;
  try {
    const result = await send({
      id: row.id,
      kind: row.kind,
      occurred_at: Math.floor(row.occurredAt.getTime() / 1000),
    });
    await markGigActivitySent(row.id);
    return result;
  } catch (err) {
    const code = err instanceof GigActivityDeliveryError ? err.code : "http_5xx";
    await markGigActivityError(row.id, code);
    throw err;
  }
}
