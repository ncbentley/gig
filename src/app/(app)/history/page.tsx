import { ChevronLeft, ChevronRight, History } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BookSwitcher, bookHref } from "@/components/book-switcher";
import { IdeaList } from "@/components/idea-list";
import { LockedPanel } from "@/components/locked";
import { PageHeader } from "@/components/page-header";
import { SignalList } from "@/components/signal-list";
import { buttonVariants } from "@/components/ui/button";
import { nowMs } from "@/lib/clock";
import { cn } from "@/lib/utils";
import { can, lowestTierWith } from "@/server/entitlements/access";
import { historyWindowLabel } from "@/server/entitlements/config";
import { getViewer } from "@/server/entitlements/service";
import { accessForDashboardView, dashboardsFor, resolveDashboardView, type DashboardView } from "@/server/feed/snapshot";
import { byNewest, goldBookCards } from "@/server/gold/sections";
import { annotateIdeaGlance } from "@/server/ideas/glance";
import { listIdeasForViewer } from "@/server/ideas/service";
import { getRecentBars } from "@/server/market-data";
import { listSignalsForViewer } from "@/server/signals/queries";

export const metadata: Metadata = { title: "History" };

const PAGE_SIZE = 50;

function pageHref(view: DashboardView, own: DashboardView, page: number) {
  const base = bookHref(view, own, "/history");
  if (page <= 1) return base;
  return `${base}${base.includes("?") ? "&" : "?"}page=${page}`;
}

export default async function HistoryPage({ searchParams }: PageProps<"/history">) {
  const viewer = await getViewer();
  const { access, config, user } = viewer;
  const sp = await searchParams;
  const requested = typeof sp.book === "string" ? sp.book : undefined;
  const books = dashboardsFor(access);
  const view = resolveDashboardView(access, requested);
  if (requested && requested !== view) redirect(bookHref(view, books[0], "/history"));
  const bookViewer = { ...viewer, access: accessForDashboardView(view, config) };
  const windowLabel = historyWindowLabel(bookViewer.access.historyDays);
  const header = (
    <PageHeader
      title="History"
      icon={History}
      description={
        view === "gold"
          ? `Gold ideas that have left the live book, newest first. ${windowLabel}.`
          : view === "silver"
            ? `Consolidated ideas that have left the live book, newest first. ${windowLabel}.`
            : `Closed signals, newest first. ${windowLabel}.`
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

  if (!can(bookViewer.access, "signals.basic_result")) {
    return (
      <>
        {back}
        {header}
        <BookSwitcher books={books} current={view} path="/history" />
        <div className="mt-8">
          <LockedPanel
            feature="signals.basic_result"
            requiredTier={lowestTierWith("signals.basic_result", config)}
            title="History is included with Basic"
            userId={user?.id}
          />
        </div>
      </>
    );
  }

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

  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const closed = await listSignalsForViewer(bookViewer, { status: "CLOSED" }, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, segment: true });
  const pages = Math.max(1, Math.ceil(closed.total / PAGE_SIZE));
  return (
    <>
      {back}
      {header}
      <BookSwitcher books={books} current={view} path="/history" />
      <div className="mt-8">
        <SignalList items={closed.items} now={now} empty="No closed signals in this history window yet." />
      </div>
      {pages > 1 && (
        <nav aria-label="Pagination" className="panel mt-4 flex items-center justify-between gap-2 rounded-xl p-2 text-sm ring-1 ring-glow/25 sm:justify-end">
          <Link href={pageHref(view, books[0], page - 1)} aria-disabled={page <= 1} className={cn(buttonVariants({ variant: "outline", size: "sm" }), page <= 1 && "pointer-events-none opacity-50")}>
            <ChevronLeft /> Prev
          </Link>
          <span className="px-2 text-muted-foreground">
            Page <span className="font-mono font-semibold text-primary tabular-nums">{page}</span> of <span className="font-mono tabular-nums text-foreground">{pages}</span>
          </span>
          <Link href={pageHref(view, books[0], page + 1)} aria-disabled={page >= pages} className={cn(buttonVariants({ variant: "outline", size: "sm" }), page >= pages && "pointer-events-none opacity-50")}>
            Next <ChevronRight />
          </Link>
        </nav>
      )}
    </>
  );
}
