import { History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookSwitcher, bookHref } from "@/components/book-switcher";
import { IdeaList } from "@/components/idea-list";
import { LockedPanel } from "@/components/locked";
import { PageHeader } from "@/components/page-header";
import { SignalList } from "@/components/signal-list";
import { nowMs } from "@/lib/clock";
import { can, lowestTierWith } from "@/server/entitlements/access";
import { getViewer } from "@/server/entitlements/service";
import { accessForDashboardView, dashboardsFor, resolveDashboardView } from "@/server/feed/snapshot";
import { byNewest, goldBookCards } from "@/server/gold/sections";
import { annotateIdeaGlance } from "@/server/ideas/glance";
import { listIdeasForViewer } from "@/server/ideas/service";
import { getRecentBars } from "@/server/market-data";
import { listSignalsForViewer } from "@/server/signals/queries";

export const metadata: Metadata = { title: "History" };

export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  const viewer = await getViewer();
  const { access, config, user } = viewer;
  const sp = await searchParams;
  const requested = typeof sp.book === "string" ? sp.book : undefined;
  const books = dashboardsFor(access);
  const view = resolveDashboardView(access, requested);
  if (requested && requested !== view) redirect(bookHref(view, books[0], "/history"));
  const bookViewer = { ...viewer, access: accessForDashboardView(view, config) };
  const header = (
    <PageHeader
      title="History"
      icon={History}
      description={
        view === "gold"
          ? "Every Gold idea that has left the live book, newest first."
          : view === "silver"
            ? "Every consolidated idea that has left the live book, newest first."
            : "Every closed signal in this history window, newest first."
      }
    />
  );
  if (!can(access, "signals.core")) {
    return (
      <>
        {header}
        <LockedPanel feature="signals.core" requiredTier={lowestTierWith("signals.core", config)} title="History is available to members" userId={user?.id} />
      </>
    );
  }

  const now = nowMs();
  const [lastBar] = (await getRecentBars(1)).slice(-1);
  const spot = lastBar?.close ?? null;

  const back = (
    <Link
      href={bookHref(view, books[0], "/dashboard")}
      className="mb-3 inline-flex rounded text-sm font-medium text-muted-foreground outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
    >
      Back to dashboard
    </Link>
  );

  if (view === "gold") {
    const history = byNewest((await goldBookCards(bookViewer, spot, now)).filter((card) => card.section === "history"));
    return (
      <>
        {back}
        {header}
        <BookSwitcher books={books} current={view} path="/history" />
        <div className="mt-8">
          <IdeaList items={history} now={now} empty="No Gold ideas in this history yet." />
        </div>
      </>
    );
  }

  if (view === "silver") {
    const history = await annotateIdeaGlance(
      byNewest((await listIdeasForViewer(bookViewer, spot)).filter((idea) => idea.phase === "history")),
      spot,
    );
    return (
      <>
        {back}
        {header}
        <BookSwitcher books={books} current={view} path="/history" />
        <div className="mt-8">
          <IdeaList items={history} now={now} empty="No ideas in this history window yet." />
        </div>
      </>
    );
  }

  const closed = await listSignalsForViewer(bookViewer, { status: "CLOSED" }, { limit: 500, segment: true });
  return (
    <>
      {back}
      {header}
      <BookSwitcher books={books} current={view} path="/history" />
      <div className="mt-8">
        <SignalList items={closed.items} now={now} empty="No closed signals in this history window yet." />
      </div>
    </>
  );
}
