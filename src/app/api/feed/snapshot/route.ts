import { accessForDashboardView, applyHistoryWindow, readDashboardSnapshot, resolveDashboardView } from "@/server/feed/snapshot";
import { can } from "@/server/entitlements/access";
import { getViewer } from "@/server/entitlements/service";

export const dynamic = "force-dynamic";

/** The precomputed dashboard for the book this member is allowed to open. */
export async function GET(request: Request) {
  const viewer = await getViewer();
  if (!viewer.user) return new Response("unauthorized", { status: 401 });
  if (!can(viewer.access, "signals.core")) return new Response("forbidden", { status: 403 });
  const requested = new URL(request.url).searchParams.get("view") ?? undefined;
  const view = resolveDashboardView(viewer.access, requested);
  const stored = await readDashboardSnapshot(view);
  if (!stored) return Response.json(null);
  const bookAccess = accessForDashboardView(view, viewer.config);
  return Response.json(applyHistoryWindow(stored, bookAccess, new Date()));
}
