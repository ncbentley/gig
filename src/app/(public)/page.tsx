import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { AffiliateStrip } from "@/components/affiliate-strip";
import { SignalList } from "@/components/signal-list";
import { TopSources } from "@/components/top-sources";
import { buttonVariants } from "@/components/ui/button";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { listPlans } from "@/server/billing/service";
import { FREE_HISTORY_DAYS, TIER_LABEL } from "@/server/entitlements/config";
import { getTierConfig } from "@/server/entitlements/service";
import { listPublicSampleSignals, listSources } from "@/server/signals/queries";
import { getTopSources } from "@/server/statistics/service";
import type { Tier } from "@/server/db/schema";

export const dynamic = "force-dynamic";

const PAID: Tier[] = ["basic", "silver", "gold"];

const BOOK_COPY: Record<Tier, string> = {
  basic: `Every valid signal from every channel, for ${FREE_HISTORY_DAYS} days. A new account sees this book with no card. Basic keeps it after the week.`,
  silver: "Nearby calls from different channels become one idea. The model does not add, edit, or close these.",
  gold: "A shorter list taken from the Silver ideas. The news read sits above the book. Each row is the idea: direction, zone, stop, targets, and how many sources agreed.",
};

const PLAN_BLURB: Record<Tier, string> = {
  basic: "Every valid signal, one week back.",
  silver: "Every consolidated idea.",
  gold: "The news read, above a shorter list of ideas.",
};

function planLines(tier: Tier, historyDays: number | null): string[] {
  const history = historyDays ? `${historyDays} days of history` : "Full history";
  if (tier === "basic") return ["Every valid signal", history];
  if (tier === "silver") return ["Nearby calls averaged into one idea", history];
  return ["The news read above the book", "A shorter list from the Silver ideas", "Direction, zone, stop, targets, and how many sources agreed", history];
}

function historyLabel(days: number | null) {
  return days ? `${days} days` : "Full history";
}

export default async function LandingPage() {
  const config = await getTierConfig();
  const [samples, sources, plans] = await Promise.all([listPublicSampleSignals(config), listSources(), listPlans()]);
  const { top, eligibleCount, sourceCount, totalClosed } = await getTopSources(sources.map((s) => s.id));
  const monthly = new Map(plans.filter((p) => p.period === "monthly").map((p) => [p.tier, p]));

  const books = [
    { key: "basic" as const, name: TIER_LABEL.basic, window: historyLabel(config.basic.historyDays), body: BOOK_COPY.basic },
    { key: "silver" as const, name: TIER_LABEL.silver, window: historyLabel(config.silver.historyDays), body: BOOK_COPY.silver },
    { key: "gold" as const, name: TIER_LABEL.gold, window: historyLabel(config.gold.historyDays), body: BOOK_COPY.gold },
  ];

  return (
    <>
      <section className="relative isolate overflow-hidden border-b border-primary/25">
        <Image
          src="/brand/hero-gold.jpg"
          alt=""
          fill
          loading="eager"
          fetchPriority="high"
          sizes="100vw"
          className="-z-10 object-cover object-[78%_42%] opacity-95"
        />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-[#040914] from-28% via-[#040914]/80 via-58% to-[#040914]/10 max-md:via-[#040914]/92" />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-40 bg-gradient-to-t from-background to-transparent" />
        <div className="mx-auto flex min-h-[calc(100dvh-4rem)] max-w-6xl flex-col justify-end px-4 pb-16 pt-16 md:justify-center md:pb-24 md:pt-20">
          <h1 className="max-w-[12ch] font-heading text-5xl font-extrabold leading-[0.92] tracking-[-0.035em] text-foreground md:text-7xl">
            Don&apos;t follow a thousand traders.
            <span className="mt-3 block">Follow all of them.</span>
          </h1>
          <p className="mt-6 max-w-[34rem] text-pretty text-lg leading-relaxed text-foreground/85">
            Every gold channel we can read, stored as posted and measured on XAU/USD minute bars.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/signup" className={cn(buttonVariants({ size: "lg" }), "px-6")}>
              Create an account <ArrowRight />
            </Link>
            <Link href="/pricing" className={cn(buttonVariants({ size: "lg", variant: "outline" }), "px-6")}>
              Compare plans
            </Link>
          </div>
          {(sources.length > 0 || totalClosed > 0) && (
            <dl className="mt-12 flex flex-wrap gap-x-12 gap-y-6">
              {sources.length > 0 && (
                <div>
                  <dd className="font-heading text-3xl font-extrabold tabular-nums tracking-tight">{sources.length.toLocaleString()}</dd>
                  <dt className="mt-1 text-sm text-muted-foreground">{sources.length === 1 ? "Channel on the tape" : "Channels on the tape"}</dt>
                </div>
              )}
              {totalClosed > 0 && (
                <div>
                  <dd className="font-heading text-3xl font-extrabold tabular-nums tracking-tight">{totalClosed.toLocaleString()}</dd>
                  <dt className="mt-1 text-sm text-muted-foreground">Measured trades</dt>
                </div>
              )}
            </dl>
          )}
          <p className="mt-8 max-w-md text-xs leading-relaxed text-muted-foreground">Results are historical measurements, not a forecast.</p>
        </div>
      </section>

      <section id="ladder" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20">
        <h2 className="max-w-[16ch] font-heading text-3xl font-extrabold tracking-[-0.03em] md:text-4xl">The same calls, read three ways.</h2>
        <p className="mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">
          Available, Active, and History sit on every book. Nothing is dropped from the tape. Each step up is a tighter reading of the full set.
        </p>
        <ol className="mt-10 border-t border-primary/20">
          {books.map((book) => {
            const featured = book.key === "gold";
            return (
              <li
                key={book.key}
                className={cn(
                  "grid gap-2 border-b border-primary/20 py-7 md:grid-cols-[9rem_minmax(0,1fr)_8rem] md:items-baseline md:gap-10",
                  featured && "border-primary/40",
                )}
              >
                <h3 className={cn("font-heading text-2xl font-extrabold tracking-tight", featured && "gold-text")}>{book.name}</h3>
                <p className="max-w-xl text-sm leading-relaxed text-foreground/85">{book.body}</p>
                <p className="font-heading text-sm font-semibold text-muted-foreground md:text-right">{book.window}</p>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="border-y border-primary/15">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="font-heading text-3xl font-extrabold tracking-[-0.03em]">Track records from the full set.</h2>
          <p className="mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">
            Lifetime results come from recorded outcomes. Ambiguous and cancelled signals stay out of the win rate. Names on this page are nicknames.
          </p>
          <div className="mt-10">
            <TopSources
              rows={top.map(({ sourceId, stats }) => ({
                sourceId,
                name: sources.find((source) => source.id === sourceId)?.nickname ?? "Source",
                closedTrades: stats.closedTrades,
                metrics: stats,
              }))}
              eligibleCount={eligibleCount}
              sourceCount={sourceCount}
            />
          </div>

          <h2 className="mt-16 font-heading text-xl font-extrabold tracking-tight">Closed trades from the book.</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">A fixed sample of finished calls. Members see a signal when it is published.</p>
          <div className="mt-6">
            <SignalList items={samples} empty="Closed signals will appear here once the first trades complete." />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="font-heading text-3xl font-extrabold tracking-[-0.03em]">How a result gets on the book.</h2>
        <p className="mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">
          Every post is stored as it was published. Later edits stay beside the original. Each signal is replayed against XAU/USD one-minute bars, with versioned rules for fills, targets, and stops. A recorded result can be recomputed from those records.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20">
        <h2 className="font-heading text-3xl font-extrabold tracking-[-0.03em]">Plans</h2>
        <p className="mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">
          Basic is $33 a month, Silver is $66, and Gold is $99. A 10-day full-access pass is $10.
        </p>
        <div className="mt-10 border-t border-primary/20">
          {PAID.map((tier) => {
            const featured = tier === "gold";
            const plan = monthly.get(tier);
            return (
              <article
                key={tier}
                className={cn(
                  "grid gap-4 border-b border-primary/20 py-7 md:grid-cols-[9rem_11rem_minmax(0,1fr)_auto] md:items-start md:gap-8",
                  featured && "border-primary/40",
                )}
              >
                <h3 className={cn("font-heading text-2xl font-extrabold tracking-tight", featured && "gold-text")}>{TIER_LABEL[tier]}</h3>
                <p className={cn("font-heading text-3xl font-extrabold tabular-nums tracking-tight", featured && "gold-text")}>
                  {plan ? fmtMoney(plan.amountCents, plan.currency) : "—"}
                  <span className="font-sans text-sm font-normal text-muted-foreground"> / month</span>
                </p>
                <div>
                  <p className="text-sm text-foreground/75">{PLAN_BLURB[tier]}</p>
                  <ul className="mt-3 space-y-1 text-sm text-foreground/85">
                    {planLines(tier, config[tier].historyDays).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
                <Link href={`/pricing?tier=${tier}&period=monthly`} className="text-sm font-semibold text-primary hover:underline md:pt-2">
                  See {TIER_LABEL[tier]} pricing
                </Link>
              </article>
            );
          })}
        </div>
        <p className="mt-8 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Basic keeps the trial book after the week. Add a card for Silver or Gold during those {FREE_HISTORY_DAYS} days and the rest of the trial is Gold access. When the week ends, billing starts on the plan you picked. Cancel any time. Access continues until the end of the paid period.
        </p>
        <div className="mt-8">
          <Link href="/signup" className={cn(buttonVariants({ size: "lg" }), "px-6")}>
            Create an account <ArrowRight />
          </Link>
        </div>
        <div className="mt-16">
          <AffiliateStrip placement="landing" />
        </div>
      </section>
    </>
  );
}
