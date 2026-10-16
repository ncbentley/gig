import { Activity, ChartCandlestick, Coins, History, Hourglass, LayoutDashboard, Radar, Radio, Trophy } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AffiliateStrip } from "@/components/affiliate-strip";
import { BookSwitcher, bookHref } from "@/components/book-switcher";
import { BookSections } from "@/components/book-sections";
import { DirectionPanel } from "@/components/direction-panel";
import { IdeaList } from "@/components/idea-list";
import { FeedRefresh } from "@/components/feed-refresh";
import { LockedPanel } from "@/components/locked";
import { PageHeader, SectionTitle } from "@/components/page-header";
import { Stat } from "@/components/signal-bits";
import { SignalList } from "@/components/signal-list";
import { TopSources } from "@/components/top-sources";
import { fmtAge, fmtPrice } from "@/lib/format";
import { can, lowestTierWith } from "@/server/entitlements/access";
import { TIER_LABEL } from "@/server/entitlements/config";
import { accessForDashboardView, dashboardsFor, readDashboardSnapshot, resolveDashboardView, type DashboardView } from "@/server/feed/snapshot";
import { getViewer } from "@/server/entitlements/service";
import { nowMs } from "@/lib/clock";

export const metadata: Metadata = { title: "Dashboard" };

const FEATURES = [
  { icon: Radio, label: "Live signals from every channel we can read" },
  { icon: ChartCandlestick, label: "Replayed against XAU/USD minute data" },
  { icon: Trophy, label: "Source track records" },
];

const BOOK_DESCRIPTION: Partial<Record<DashboardView, string>> = {
  silver: "The Silver book. Consolidated ideas from nearby calls, wider than Gold.",
  basic: "The Basic book. Individual signals, with no grouping.",
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
  const snap = await readDashboardSnapshot(view);
  const now = nowMs();
  const lastBar = snap?.spot;

  const header = (
    <PageHeader
      title="Dashboard"
      icon={LayoutDashboard}
      description={
        view !== books[0] && BOOK_DESCRIPTION[view]
          ? BOOK_DESCRIPTION[view]
          : "Available, active, and a short history. Each step up is a tighter reading of the same calls."
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
                <span className="font-semibold text-foreground/90">XAU/USD</span> last bar {fmtAge(lastBar.timestamp, now)} ago
              </div>
              <div className="gold-text font-mono text-2xl font-bold tabular-nums tracking-tight">{fmtPrice(lastBar.close)}</div>
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
  const signals = snap?.signals;
  const pending = (signals?.open ?? []).filter((item) => item.status === "PENDING");
  const activeSignals = (signals?.open ?? []).filter((item) => item.status !== "PENDING");
  const availableCount = ideas ? ideas.available.length : pending.length;
  const activeCount = ideas ? ideas.active.length : (signals?.active ?? activeSignals.length);
  const historyCount = ideas ? ideas.historyCount : (signals?.historyCount ?? 0);

  return (
    <>
      <FeedRefresh />
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
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Available" value={availableCount} hint="can still be filled" icon={Hourglass} />
        <Stat label="Active" value={activeCount} hint="entered, not closed" icon={Activity} tone="gold" />
        <Stat
          label="History"
          value={historyCount}
          hint={bookAccess.historyDays ? `last ${bookAccess.historyDays} days` : "full history"}
          icon={History}
        />
        <Stat label="Tracked sources" value={ranking.sourceCount} icon={Radar} />
      </div>

      {ideas ? (
        <BookSections
          historyCount={ideas.historyCount}
          historyHref={historyHref}
          available={<IdeaList items={ideas.available} now={now} empty="Nothing is waiting to fill." />}
          active={<IdeaList items={ideas.active} now={now} empty="Nothing is active right now." />}
          history={<IdeaList items={ideas.history} now={now} empty={`No trades in the ${TIER_LABEL[view === "gold" ? "gold" : "silver"]} history window yet.`} />}
        />
      ) : (
        <BookSections
          historyCount={signals?.historyCount ?? 0}
          historyHref={historyHref}
          available={<SignalList items={pending} now={now} empty="No entries are waiting to fill." />}
          active={<SignalList items={activeSignals} now={now} empty="No trades are active right now." />}
          history={<SignalList items={signals?.closed ?? []} now={now} empty="No closed signals in this history window yet." />}
        />
      )}

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
