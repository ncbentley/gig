import Link from "next/link";
import { TIER_LABEL } from "@/server/entitlements/config";
import type { DashboardView } from "@/server/feed/snapshot";
import { cn } from "@/lib/utils";

const BOOK_LABEL: Partial<Record<DashboardView, string>> = {
  gold: TIER_LABEL.gold,
  silver: TIER_LABEL.silver,
  basic: TIER_LABEL.basic,
};

export function bookHref(book: DashboardView, own: DashboardView, path: "/dashboard" | "/history") {
  return book === own ? path : `${path}?book=${book}`;
}

export function BookSwitcher({
  books,
  current,
  path = "/dashboard",
}: {
  books: DashboardView[];
  current: DashboardView;
  path?: "/dashboard" | "/history";
}) {
  if (books.length < 2) return null;
  const own = books[0];
  return (
    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">Your membership includes the wider books below it.</p>
      <nav aria-label="Dashboards" className="flex w-fit flex-wrap gap-1 rounded-lg bg-muted p-[3px]">
        {books.map((book) => {
          const on = book === current;
          return (
            <Link
              key={book}
              href={bookHref(book, own, path)}
              aria-current={on ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
                on && "gold-fill font-semibold text-primary-foreground shadow-[0_0_16px_-6px_rgb(245_197_66/0.7)] hover:text-primary-foreground",
              )}
            >
              {BOOK_LABEL[book]}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
