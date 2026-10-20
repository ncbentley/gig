"use client";

import { useEffect, useState } from "react";
import { Activity, History, Hourglass, Radar } from "lucide-react";
import { BookSections } from "@/components/book-sections";
import { IdeaList, type IdeaListItem } from "@/components/idea-list";
import { SignalList } from "@/components/signal-list";
import { Stat } from "@/components/signal-bits";

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
  sourceCount,
}: {
  view: Book;
  snap: DashboardLiveSnap;
  historyCount: number;
  historyHint: string;
  historyEmpty: string;
  historyHref: string;
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
          historyCount={shownHistory}
          historyHref={historyHref}
          available={<SignalList items={pending} now={now} empty="No entries are waiting to fill." />}
          active={<SignalList items={activeSignals} now={now} empty="No trades are active right now." />}
          history={<SignalList items={data.signals?.closed ?? []} now={now} empty={historyEmpty} />}
        />
      )}
    </>
  );
}
