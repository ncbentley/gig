import { ChartCandlestick, Scale, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { LockedPanel } from "@/components/locked";
import { PageHeader } from "@/components/page-header";
import { TopSources } from "@/components/top-sources";
import { buttonVariants } from "@/components/ui/button";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { can, lowestTierWith } from "@/server/entitlements/access";
import { getViewer } from "@/server/entitlements/service";
import { listSourceDirectory, SOURCE_DIRECTORY_TOP } from "@/server/signals/queries";
import { EXPECTANCY_MIN_RATED } from "@/server/statistics/compute";

export const metadata: Metadata = { title: "Top sources" };

const FEATURES = [
  { icon: ChartCandlestick, label: "Every trade replayed on minute data" },
  { icon: Scale, label: `Expectancy rank needs ${EXPECTANCY_MIN_RATED} known-R trades` },
  { icon: Trophy, label: `Top ${SOURCE_DIRECTORY_TOP} by expectancy, plus search` },
];

function directoryHref(q: string, eligible: boolean, page: number) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (eligible) params.set("eligible", "known-r");
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/sources?${query}` : "/sources";
}

export default async function TopSourcesPage({ searchParams }: PageProps<"/sources">) {
  const viewer = await getViewer();
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const eligibleOnly = sp.eligible === "known-r";
  const page = Math.max(1, Number(sp.page) || 1);
  const searching = q.length > 0 || eligibleOnly;
  const header = (
    <PageHeader
      title="Top sources"
      icon={Trophy}
      features={FEATURES}
      description={`Top ${SOURCE_DIRECTORY_TOP} by expectancy among sources with at least ${EXPECTANCY_MIN_RATED} known-R trades. Search finds a tracked source outside that list. Win rate uses closed trades. Names are nicknames unless you are an admin.`}
    />
  );
  if (!can(viewer.access, "signals.core")) {
    return (
      <>
        {header}
        <LockedPanel feature="signals.core" requiredTier={lowestTierWith("signals.core", viewer.config)} title="Source rankings are available to members" userId={viewer.user?.id} />
      </>
    );
  }
  const directory = await listSourceDirectory(viewer, { q, page, eligibleOnly });
  const rows = searching ? directory.matches : directory.top;
  return (
    <>
      {header}
      <p className="mb-4 max-w-3xl text-sm leading-relaxed text-muted-foreground">
        Page read {fmtDateTime(new Date())}. {directory.eligibleCount.toLocaleString()} expectancy-eligible of {directory.sourceCount.toLocaleString()} tracked sources.
        Closed-trade sum {directory.totalClosed.toLocaleString()}. That sum excludes fills before publication. It is not the stored-call count and not the known-R count.
        {searching
          ? ` Showing ${directory.matchTotal.toLocaleString()} match${directory.matchTotal === 1 ? "" : "es"}.`
          : ` The table is the top ${rows.length} of that eligible set (cap ${SOURCE_DIRECTORY_TOP}).`}
      </p>
      <form method="get" className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-56 flex-1 flex-col gap-1 text-xs text-muted-foreground">
          Search tracked sources
          <input
            name="q"
            defaultValue={q}
            placeholder="Visible source name"
            className="h-9 rounded-lg border border-primary/30 bg-black/20 px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-foreground/85">
          <input type="checkbox" name="eligible" value="known-r" defaultChecked={eligibleOnly} />
          Known-R eligible only
        </label>
        <button type="submit" className={cn(buttonVariants({ size: "sm" }))}>
          Search
        </button>
        {searching && (
          <Link href="/sources" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Clear
          </Link>
        )}
      </form>
      {rows.length > 0 ? (
        <TopSources
          rows={rows}
          eligibleCount={directory.eligibleCount}
          sourceCount={directory.sourceCount}
          lockedHref="/upgrade?tier=silver&feature=sources.stats.summary"
          hrefBase="/sources"
        />
      ) : searching ? (
        <p className="rounded-xl border border-dashed border-glow/30 bg-glow/[0.03] p-8 text-center text-sm text-muted-foreground">
          No tracked source matches that search. The known-R filter hides sources that are unranked for expectancy. Clear it to search every tracked name.
        </p>
      ) : (
        <TopSources rows={[]} eligibleCount={directory.eligibleCount} sourceCount={directory.sourceCount} hrefBase="/sources" />
      )}
      {searching && directory.pages > 1 && (
        <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Source pages">
          {directory.page > 1 ? (
            <Link href={directoryHref(q, eligibleOnly, directory.page - 1)} className="font-semibold text-primary hover:underline">
              Previous
            </Link>
          ) : (
            <span className="text-muted-foreground">Previous</span>
          )}
          <span className="text-muted-foreground">
            Page {directory.page} of {directory.pages}
          </span>
          {directory.page < directory.pages ? (
            <Link href={directoryHref(q, eligibleOnly, directory.page + 1)} className="font-semibold text-primary hover:underline">
              Next
            </Link>
          ) : (
            <span className="text-muted-foreground">Next</span>
          )}
        </nav>
      )}
    </>
  );
}
