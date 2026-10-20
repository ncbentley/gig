import { getCurrentUser } from "@/server/auth";
import { subscribeFeedRevision } from "@/server/feed/hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Pushes a dashboard revision to open browsers. The database notifies this process; nothing is polled. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  let beat: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = (revision: string) => {
        controller.enqueue(encoder.encode(`data: ${revision}\n\n`));
      };
      unsubscribe = subscribeFeedRevision(send);
      send("ready");
      beat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          if (beat) clearInterval(beat);
        }
      }, 20_000);
    },
    cancel() {
      unsubscribe();
      if (beat) clearInterval(beat);
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
