import { sql } from "drizzle-orm";
import { getDbHandle } from "@/server/db";

type Listener = (revision: string) => void;

const g = globalThis as unknown as { __feedHub?: FeedHub };

class FeedHub {
  private listeners = new Set<Listener>();
  private last = "";
  private listenOnce: Promise<void> | null = null;

  emit(revision: string) {
    if (!revision || revision === this.last) return;
    this.last = revision;
    for (const listener of this.listeners) listener(revision);
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    void this.ensureListen();
    return () => {
      this.listeners.delete(listener);
    };
  }

  private ensureListen() {
    if (!process.env.DATABASE_URL) return;
    if (!this.listenOnce) this.listenOnce = this.listen().catch((err) => {
      this.listenOnce = null;
      console.error("[feed] listen failed:", err instanceof Error ? err.message : "error");
    });
  }

  private async listen() {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.on("error", (err) => {
      console.error("[feed] listen dropped:", err.message);
      this.listenOnce = null;
      void client.end().catch(() => {});
      setTimeout(() => this.ensureListen(), 2_000).unref?.();
    });
    await client.connect();
    await client.query("LISTEN feed_revision");
    client.on("notification", (msg) => {
      if (msg.channel === "feed_revision" && msg.payload) this.emit(msg.payload);
    });
  }
}

function hub() {
  if (!g.__feedHub) g.__feedHub = new FeedHub();
  return g.__feedHub;
}

/** Fans a dashboard revision out to SSE handlers in this process, and to other processes via Postgres. */
export async function publishFeedRevision(revision: string) {
  hub().emit(revision);
  const handle = await getDbHandle();
  if (handle.driver !== "postgres") return;
  await handle.db.execute(sql`select pg_notify('feed_revision', ${revision})`);
}

export function subscribeFeedRevision(listener: Listener) {
  return hub().subscribe(listener);
}
