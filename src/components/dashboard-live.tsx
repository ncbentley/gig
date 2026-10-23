"use client";

import { useEffect, useState } from "react";
import { Activity, History, Hourglass, Lock, Radar } from "lucide-react";
import Link from "next/link";
import { BookSections } from "@/components/book-sections";
import { IdeaList, type IdeaListItem } from "@/components/idea-list";
import { SignalList } from "@/components/signal-list";
import { Stat } from "@/components/signal-bits";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Book = "admin" | "gold" | "silver" | "basic" | "free";

type SignalItems = React.ComponentProps<typeof SignalList>["items"];

interface BookBlock {
  available: IdeaListItem[];
  active: IdeaListItem[];
  history: IdeaListItem[];
  historyCount: number;
}

export interface DashboardLiveSnap {
  signals: { open: SignalItems; closed: SignalItems; pending: number; active: number } | null;
  ideas: BookBlock | null;
  gold: BookBlock | null;
}

/**
 * Keeps an open dashboard in step with the queue. Postgres notifies the server,
 * the server pushes one event, and this replaces the lists from the snapshot
 * that was just written. The page is not polled and not re-rendered from the server.
 */
export function DashboardLive({
  view,
  snap,
  historyCount,
  historyHint,
  historyEmpty,
  historyHref,
  historyLocked = false,
  sourceCount,
}: {
  view: Book;
  snap: DashboardLiveSnap;
  historyCount: number;
  historyHint: string;
  historyEmpty: string;
  historyHref: string;
  historyLocked?: boolean;
  sourceCount: number;
}) {
  const [data, setData] = useState(snap);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1_000);
    const source = new EventSource("/api/feed/stream");
    let closed = false;
    let generation = 0;
    source.onmessage = () => {
      const mine = ++generation;
      void fetch(`/api/feed/snapshot?view=${encodeURIComponent(view)}`, { cache: "no-store" })
        .then((res) => (res.ok ? res.json() : null))
        .then((next: DashboardLiveSnap | null) => {
          if (!closed && next && mine === generation) setData(next);
        })
        .catch(() => {});
    };
    return () => {
      closed = true;
      clearInterval(clock);
      source.close();
    };
  }, [view]);

  const book = view === "gold" ? data.gold : view === "silver" ? data.ideas : null;
  const pending = (data.signals?.open ?? []).filter((item) => item.status === "PENDING");
  const activeSignals = (data.signals?.open ?? []).filter((item) => item.status !== "PENDING");
  const availableCount = book ? book.available.length : (data.signals?.pending ?? pending.length);
  const activeCount = book ? book.active.length : (data.signals?.active ?? activeSignals.length);
  const shownHistory = view === "gold" ? (book?.historyCount ?? historyCount) : historyCount;

  return (
    <>
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Available" value={availableCount} hint="can still be filled" icon={Hourglass} />
        <Stat label="Active" value={activeCount} hint="entered, not closed" icon={Activity} tone="gold" />
        <Stat label="History" value={shownHistory} hint={historyHint} icon={History} />
        <Stat label="Tracked sources" value={sourceCount} icon={Radar} />
      </div>
      {book ? (
        <BookSections
          historyCount={book.historyCount}
          historyHref={historyHref}
          available={<IdeaList items={book.available} now={now} empty="Nothing is waiting to fill." />}
          active={<IdeaList items={book.active} now={now} empty="Nothing is active right now." />}
          history={<IdeaList items={book.history} now={now} empty={historyEmpty} />}
        />
      ) : (
        <BookSections
          historyCount={historyLocked ? 0 : shownHistory}
          historyHref={historyHref}
          available={<SignalList items={pending} now={now} empty="No entries are waiting to fill." />}
          active={<SignalList items={activeSignals} now={now} empty="No trades are active right now." />}
          history={
            historyLocked ? (
              <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-primary/40 bg-[radial-gradient(ellipse_at_top,rgb(245_197_66/0.09),transparent_65%)] p-8 text-center">
                <span className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/60">
                  <Lock className="size-5" />
                </span>
                <div className="font-heading text-base font-bold tracking-tight">History is included with Basic</div>
                <p className="max-w-sm text-xs text-muted-foreground">Closed trades, results, stops, and targets stay locked on a free account.</p>
                <Link href="/upgrade?tier=basic&feature=signals.basic_result" className={cn(buttonVariants(), "mt-1")}>
                  Upgrade to Basic
                </Link>
              </div>
            ) : (
              <SignalList items={data.signals?.closed ?? []} now={now} empty={historyEmpty} />
            )
          }
        />
      )}
    </>
  );
}
