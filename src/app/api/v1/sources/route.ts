import { apiError, json, withViewer } from "@/server/api";
import { can, lowestTierWith } from "@/server/entitlements/access";
import { presentSourceSummary } from "@/server/presenters";
import { listSources } from "@/server/signals/queries";
import { getSourceStats } from "@/server/statistics/service";

export async function GET() {
  return withViewer(async (viewer) => {
    if (!can(viewer.access, "signals.core")) {
      return apiError(403, "plan_required", "An active membership is required.", { requiredTier: lowestTierWith("signals.core", viewer.config) });
    }
    const sources = await listSources({ includeQa: viewer.access.isAdmin });
    const data = await Promise.all(sources.map(async (s) => presentSourceSummary(s, await getSourceStats(s.id), viewer.access, viewer.config)));
    return json({ data });
  });
}
