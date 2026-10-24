import { ChartCandlestick, Coins, LayoutDashboard, Radio, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AffiliateStrip } from "@/components/affiliate-strip";
import { BookSwitcher, bookHref } from "@/components/book-switcher";
import { DirectionPanel } from "@/components/direction-panel";
import { DashboardLive } from "@/components/dashboard-live";
import { LockedPanel } from "@/components/locked";
import { PageHeader, SectionTitle } from "@/components/page-header";
import { TopSources } from "@/components/top-sources";
import { fmtAge, fmtDateTime, fmtPrice } from "@/lib/format";
import { can, lowestTierWith } from "@/server/entitlements/access";
import { historyWindowLabel, TIER_LABEL } from "@/server/entitlements/config";
import { accessForDashboardView, applyHistoryWindow, dashboardsFor, readDashboardSnapshot, resolveDashboardView, type DashboardView } from "@/server/feed/snapshot";
import { countHistoryIdeasForAccess } from "@/server/ideas/service";
import { getViewer } from "@/server/entitlements/service";
import { countClosedSignalsForAccess } from "@/server/signals/queries";
import { nowMs } from "@/lib/clock";
import { isGoldMarketOpen } from "@/server/market-data/provider";

export const metadata: Metadata = { title: "Dashboard" };

const FEATURES = [
  { icon: Radio, label: "Stored calls from channels we can read" },
  { icon: ChartCandlestick, label: "Replayed against XAU/USD minute data" },
  { icon: Trophy, label: "Source track records" },
];

const BOOK_DESCRIPTION: Partial<Record<DashboardView, string>> = {
  gold: "The Gold book. A shorter list than Silver: a kept Silver idea, or a zone the model composed. A composed zone does not copy one Silver idea.",
  silver: "The Silver book. Nearby calls grouped into ideas. Wider than Gold.",
  basic: "The Basic book. Individual third-party signals, with no grouping.",
};

function ViewAll({ href }: { href: string }) {
  return (
    <Link href={href} className="rounded text-sm font-medium text-[#8db6ff] outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">
      View all
    </Link>
  );
}

export default async function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const viewer = await getViewer();
  const { access, config, user } = viewer;
  const sp = await searchParams;
  const requested = typeof sp.book === "string" ? sp.book : undefined;
  const books = dashboardsFor(access);
  const view = resolveDashboardView(access, requested);
  if (requested && requested !== view) redirect(bookHref(view, books[0], "/dashboard"));
  const bookAccess = accessForDashboardView(view, config);
  const now = nowMs();
  const stored = await readDashboardSnapshot(view);
  const snap = stored ? applyHistoryWindow(stored, bookAccess, new Date(now)) : null;
  const lastBar = snap?.spot;
  const sessionOpen = isGoldMarketOpen(new Date(now));

  const header = (
    <PageHeader
      title="Dashboard"
      icon={LayoutDashboard}
      description={
        BOOK_DESCRIPTION[view] ?? "Available, active, and a short history of stored calls."
      }
      features={FEATURES}
      actions={
        lastBar && (
          <div className="panel-gold flex items-center gap-3 rounded-xl py-2.5 pl-2.5 pr-4 shadow-[0_0_26px_-8px_rgb(245_197_66/0.6)] ring-1 ring-primary/55">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/55">
              <Coins className="size-5" />
            </span>
            <div className="text-right">
              <div className="text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground/90">XAU/USD</span> stored bar {fmtDateTime(lastBar.timestamp)}
              </div>
              <div className="gold-text font-mono text-2xl font-bold tabular-nums tracking-tight">{fmtPrice(lastBar.close)}</div>
              <div className="max-w-[16rem] text-[11px] leading-snug text-muted-foreground">
                {fmtAge(lastBar.timestamp, now)} after that bar. {sessionOpen ? "Gold session open" : "Gold session closed"} by the Sunday 22:00–Friday 21:00 UTC window. This is the stored bar, not a live quote.
              </div>
            </div>
          </div>
        )
      }
    />
  );

  if (!can(access, "signals.core")) {
    return (
      <>
        {header}
        <LockedPanel
          feature="signals.core"
          requiredTier={lowestTierWith("signals.core", config)}
          title="Signals are available to members"
          userId={user?.id}
        />
        <div className="mt-6">
          <AffiliateStrip placement="dashboard" />
        </div>
      </>
    );
  }

  const silver = view === "silver";
  const goldBook = view === "gold";
  const historyHref = bookHref(view, books[0], "/history");
  const direction = snap?.direction ?? null;
  const ranking = snap?.ranking ?? { rows: [], eligibleCount: 0, sourceCount: 0 };
  const ideas = goldBook ? snap?.gold : silver ? snap?.ideas : null;
  const historyCount = goldBook
    ? (ideas?.historyCount ?? 0)
    : silver
      ? await countHistoryIdeasForAccess(bookAccess)
      : bookAccess.historyDays !== null
        ? await countClosedSignalsForAccess(bookAccess)
        : (snap?.signals?.historyCount ?? 0);
  const historyEmpty = ideas
    ? `No trades in the ${TIER_LABEL[view === "gold" ? "gold" : "silver"]} history window yet.`
    : "No closed signals in this history window yet.";

  return (
    <>
      {header}
      <BookSwitcher books={books} current={view} />
      {!snap ? (
        <p className="text-sm text-muted-foreground">The dashboard is being prepared.</p>
      ) : (
        <>
      <DirectionPanel
        direction={direction}
        now={now}
        empty={access.isAdmin ? "Star a channel on the Telegram page. Its posts feed this read." : "No direction read yet."}
      />
      <DashboardLive
        key={view}
        view={view}
        snap={snap}
        historyCount={historyCount}
        historyHint={historyWindowLabel(bookAccess.historyDays)}
        historyEmpty={historyEmpty}
        historyHref={historyHref}
        historyLocked={!can(bookAccess, "signals.basic_result")}
        sourceCount={ranking.sourceCount}
      />

      <section className="mt-8">
        <SectionTitle icon={Trophy} title="Top sources" action={<ViewAll href="/sources" />} />
        <TopSources
          rows={ranking.rows}
          hrefBase="/sources"
          eligibleCount={ranking.eligibleCount}
          sourceCount={ranking.sourceCount}
          lockedHref={can(access, "sources.stats.summary") ? undefined : "/upgrade?tier=silver&feature=sources.stats.summary"}
        />
      </section>

      <div className="mt-8">
        <AffiliateStrip placement="dashboard" />
      </div>
        </>
      )}
    </>
  );
}
