import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { buyPassAction } from "@/app/actions/billing";
import { AffiliateStrip } from "@/components/affiliate-strip";
import { IdeaList } from "@/components/idea-list";
import { SignalList } from "@/components/signal-list";
import { TopSources } from "@/components/top-sources";
import { buttonVariants } from "@/components/ui/button";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/server/auth";
import { PASS_PRICE_CENTS, purchasedPass } from "@/server/billing/pass";
import { listPlans } from "@/server/billing/service";
import { historyWindowLabel, TIER_LABEL } from "@/server/entitlements/config";
import { getTierConfig } from "@/server/entitlements/service";
import { readDashboardSnapshot } from "@/server/feed/snapshot";
import { listPublicSampleSignals, listSources } from "@/server/signals/queries";
import { REFERRAL_FEE_CENTS } from "@/server/referrals/money";
import { getTopSources } from "@/server/statistics/service";
import type { Tier } from "@/server/db/schema";

export const dynamic = "force-dynamic";

const PAID: Tier[] = ["basic", "silver", "gold"];

const PLAN_BLURB: Record<Tier, string> = {
  basic: "Your entry point into gold-signal intelligence.",
  silver: "More history. A consolidated view of nearby calls.",
  gold: "A more refined set of ideas with full historical access.",
};

const QUESTIONS = [
  "Who consistently gets it right?",
  "Which sources have a measurable track record?",
  "How did their calls perform when compared with actual gold prices?",
  "Are you following skill, or simply seeing the wins someone wants you to see?",
];

const DIFFERENCE = [
  {
    title: "Track the calls",
    body: "Collect and organize gold-trading signals from a broad range of sources, creating a record that goes beyond individual screenshots and claims.",
  },
  {
    title: "Measure the outcomes",
    body: "Evaluate eligible trades against gold price data using defined entry, stop-loss, and take-profit rules.",
  },
  {
    title: "Compare the performance",
    body: "Explore source rankings, historical results, and available performance metrics to understand how different sources have performed.",
  },
  {
    title: "See the bigger picture",
    body: "Use aggregated signals and source analysis to better understand the broader gold-trading landscape, not just one trader's opinion.",
  },
];

const STEPS = [
  {
    title: "We collect the signals",
    body: "GIG tracks gold-trading sources and organizes their published calls into structured records.",
  },
  {
    title: "We measure what happened",
    body: "Eligible trades are replayed against XAU/USD market data using defined evaluation rules.",
  },
  {
    title: "You explore the evidence",
    body: "Compare source performance, examine trade histories, and access the level of gold intelligence that fits your needs.",
  },
];

const TRUST = [
  "Recorded signals provide a history to evaluate.",
  "Trade-replay rules determine how entries, stops, and targets are assessed.",
  "Sample sizes and calculation methods matter when comparing performance.",
  "Historical outcomes are not predictions or guarantees of future results.",
];

const TIER_TYPE: Record<(typeof PAID)[number], string> = {
  basic: "text-white",
  silver: "silver-text",
  gold: "gold-text",
};

/** A public row needs a stop and a short target list. Live books also contain calls with no stop, or a dozen targets from a bad parse. */
function hasTradePlan(targetCount: number, stopLoss: number | null) {
  return stopLoss != null && targetCount >= 1 && targetCount <= 9;
}

function signalPlan(item: { stopLoss?: number | null; targets?: unknown[] | { length: number }; levels?: { locked: boolean; data?: { stopLoss: number | null; targets: unknown[] } } }) {
  if (item.levels && "locked" in item.levels) {
    if (item.levels.locked || !item.levels.data) return { stopLoss: null, count: 0 };
    return { stopLoss: item.levels.data.stopLoss, count: item.levels.data.targets.length };
  }
  return { stopLoss: item.stopLoss ?? null, count: Array.isArray(item.targets) ? item.targets.length : 0 };
}

function byNewest<T>(items: T[], time: (item: T) => string) {
  return [...items].sort((a, b) => Date.parse(time(b)) - Date.parse(time(a)));
}

function crowdRead(items: { direction: string }[]): string {
  const longs = items.filter((item) => item.direction === "LONG").length;
  const shorts = items.length - longs;
  if (items.length === 0) return "No active calls right now.";
  if (longs === shorts) return `${items.length} active calls, split evenly. A mixed book is a weaker read.`;
  const side = longs > shorts ? "long" : "short";
  return `${Math.max(longs, shorts)} of ${items.length} active calls are ${side}.`;
}

function PassButton({ used, size, label }: { used: boolean; size: "sm" | "lg"; label: string }) {
  if (used) return <p className="text-sm text-muted-foreground">This account already used its 10-day pass.</p>;
  return (
    <form action={buyPassAction}>
      <button type="submit" className={cn(buttonVariants({ size }), size === "lg" && "px-6", "w-fit")}>
        {label} {size === "lg" && <ArrowRight />}
      </button>
    </form>
  );
}

function planLines(tier: Tier, historyDays: number | null): string[] {
  const history = historyWindowLabel(historyDays);
  if (tier === "basic") return ["Access to eligible signals", history];
  if (tier === "silver") return ["Nearby calls averaged into one idea", history];
  return ["A shorter list selected from Silver ideas", "News context alongside selected ideas", history];
}

export default async function LandingPage() {
  const config = await getTierConfig();
  const [samples, sources, plans, basicBook, silverBook, goldBook] = await Promise.all([
    listPublicSampleSignals(config),
    listSources(),
    listPlans(),
    readDashboardSnapshot("basic"),
    readDashboardSnapshot("silver"),
    readDashboardSnapshot("gold"),
  ]);
  const { top, eligibleCount, sourceCount, totalClosed } = await getTopSources(sources.map((s) => s.id), 8);
  const monthly = new Map(plans.filter((p) => p.period === "monthly").map((p) => [p.tier, p]));
  const basicActive = byNewest(
    (basicBook?.signals?.open ?? []).filter((item) => {
      const plan = signalPlan(item);
      return item.status !== "PENDING" && hasTradePlan(plan.count, plan.stopLoss);
    }),
    (item) => item.signalTime,
  );
  const silverIdeas = byNewest(
    (silverBook?.ideas?.active ?? []).filter((item) => item.sourceCount >= 3 && hasTradePlan(item.targets.length, item.stopLoss)),
    (item) => item.newestSignalAt,
  );
  const user = await getCurrentUser();
  const passUsed = user ? Boolean(await purchasedPass(user.id)) : false;
  const goldIdeas = byNewest(
    [...(goldBook?.gold?.available ?? []), ...(goldBook?.gold?.active ?? [])].filter(
      (item) => item.sourceCount === 0 && hasTradePlan(item.targets.length, item.stopLoss),
    ),
    (item) => item.newestSignalAt,
  ).slice(0, 1);

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
          <h1 className="max-w-[16ch] font-heading text-5xl font-extrabold leading-[0.94] tracking-[-0.035em] text-foreground md:text-6xl">
            Stop guessing who to trust. Find out who&apos;s actually winning.
          </h1>
          <p className="mt-6 max-w-[38rem] text-pretty text-lg leading-relaxed text-foreground/85">
            Don&apos;t just follow one or two gold traders.
            {sources.length > 0
              ? ` We track ${sources.length.toLocaleString()} gold-trading channels and measure their calls against XAU/USD.`
              : " We track the gold-trading channels we can read and measure their calls against XAU/USD."}{" "}
            Discover which sources have delivered measurable results, how their trades performed, and what the data reveals about the wider gold-trading landscape.
          </p>
          <div className="mt-8">
            <PassButton used={passUsed} size="lg" label="Get the 10-day pass" />
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              {fmtMoney(PASS_PRICE_CENTS, "usd")} once for Gold access. One per account. It does not renew.
            </p>
          </div>
          <dl className="mt-12 flex flex-wrap gap-x-12 gap-y-6">
            {sources.length > 0 && (
              <div>
                <dd className="font-heading text-3xl font-extrabold tabular-nums tracking-tight">{sources.length.toLocaleString()}</dd>
                <dt className="mt-1 text-sm text-muted-foreground">Tracked sources</dt>
              </div>
            )}
            {totalClosed > 0 && (
              <div>
                <dd className="font-heading text-3xl font-extrabold tabular-nums tracking-tight">{totalClosed.toLocaleString()}</dd>
                <dt className="mt-1 text-sm text-muted-foreground">Measured trades</dt>
              </div>
            )}
            <div>
              <dd className="font-heading text-3xl font-extrabold tracking-tight">XAU/USD</dd>
              <dt className="mt-1 text-sm text-muted-foreground">Market-based analysis</dt>
            </div>
          </dl>
        </div>
      </section>

      <section className="border-b border-primary/15">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="max-w-[18ch] font-heading text-3xl font-extrabold tracking-[-0.03em] md:text-4xl">See how sources compare.</h2>
          <p className="mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">
            Ranked sources, using historical performance and the same evaluation rules. Names on this page are nicknames.
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
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="max-w-[20ch] font-heading text-3xl font-extrabold tracking-[-0.03em] md:text-4xl">Everyone has a gold signal. But who has the track record?</h2>
        <p className="mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">
          Telegram is full of traders predicting where gold is headed. Some publish impressive wins. Others post conflicting calls. A winning screenshot tells you very little about how a trader performs over hundreds of trades.
        </p>
        <ul className="mt-8 max-w-xl space-y-3 text-foreground/90">
          {QUESTIONS.map((question) => (
            <li key={question} className="border-l border-primary/40 pl-4">
              {question}
            </li>
          ))}
        </ul>
        <p className="mt-8 max-w-xl text-pretty leading-relaxed text-foreground/85">You shouldn&apos;t have to guess. You should be able to examine the evidence.</p>
      </section>

      <section className="border-y border-primary/15">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="max-w-[18ch] font-heading text-3xl font-extrabold tracking-[-0.03em] md:text-4xl">One market. Hundreds of sources. A clearer picture.</h2>
          <p className="mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">
            Gold Intelligence Gateway brings gold-trading signals together and evaluates their historical outcomes against XAU/USD market data.
          </p>
          <div className="mt-12 grid gap-x-16 gap-y-10 md:grid-cols-2">
            {DIFFERENCE.map((item) => (
              <article key={item.title}>
                <h3 className="font-heading text-xl font-extrabold tracking-tight">{item.title}</h3>
                <p className="mt-2 max-w-md text-sm leading-relaxed text-foreground/80">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="max-w-[16ch] font-heading text-3xl font-extrabold tracking-[-0.03em] md:text-4xl">Talk is cheap. The track record matters.</h2>
        <p className="mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">
          Anyone can call a gold move. The important question is what happened next. These are finished calls from the book, measured by the same replay rules. Members see a signal when it is published.
        </p>
        <div className="mt-10 grid gap-10 md:grid-cols-3">
          <article>
            <h3 className="font-heading text-lg font-extrabold">Look beyond the winning screenshot</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Examine recorded calls and the outcomes produced by the trade-replay methodology.</p>
          </article>
          <article>
            <h3 className="font-heading text-lg font-extrabold">Understand the numbers</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Win rate and expectancy are shown with the sample size behind them.</p>
          </article>
          <article>
            <h3 className="font-heading text-lg font-extrabold">Same rules every time</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Entries, stops, and targets are assessed from the stored post and the minute tape.</p>
          </article>
        </div>
        <div className="mt-10">
          <SignalList items={samples} empty="Closed trades will appear here once this sample is recorded." />
        </div>
        <p className="mt-6 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Historical results depend on the replay rules and market data. Past performance does not guarantee future results.
        </p>
      </section>

      <section id="ladder" className="scroll-mt-20 border-y border-primary/15">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="max-w-[18ch] font-heading text-3xl font-extrabold tracking-[-0.03em] md:text-4xl">From thousands of calls to useful intelligence.</h2>
          <ol className="mt-12 border-t border-primary/20">
            {STEPS.map((step, index) => (
              <li key={step.title} className="grid gap-3 border-b border-primary/20 py-7 md:grid-cols-[4rem_minmax(0,1fr)] md:gap-8">
                <p className="font-heading text-2xl font-extrabold tabular-nums text-primary">{index + 1}</p>
                <div className="max-w-xl">
                  <h3 className="font-heading text-xl font-extrabold tracking-tight">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-foreground/80">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-b border-primary/15">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="max-w-[18ch] font-heading text-3xl font-extrabold tracking-[-0.03em] md:text-4xl">What each level shows.</h2>
          <p className="mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">One set of calls. Each level keeps less of it.</p>

          <div className="mt-14">
            <h3 className="font-heading text-2xl font-extrabold tracking-tight text-white">Basic</h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-foreground/80">Every call, side by side. When most of them point the same way, that is the crowd.</p>
            <p className="mt-3 font-heading text-lg font-extrabold tracking-tight">{crowdRead(basicActive)}</p>
            <div className="mt-5">
              <SignalList items={basicActive.slice(0, 6)} empty="Active calls will show here once the book has open trades." />
            </div>
          </div>

          <div className="mt-16">
            <h3 className="silver-text font-heading text-2xl font-extrabold tracking-tight">Silver</h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-foreground/80">The same calls, grouped. Nearby entries become one idea, so the list is shorter.</p>
            <div className="mt-5">
              <IdeaList items={silverIdeas.slice(0, 4)} empty="Grouped ideas will show here once nearby calls line up." />
            </div>
          </div>

          <div className="mt-16">
            <h3 className="gold-text font-heading text-2xl font-extrabold tracking-tight">Gold</h3>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-foreground/80">Basic and Silver, plus a shorter list kept only when the book agrees.</p>
            <div className="mt-5">
              <IdeaList items={goldIdeas} empty="A composed idea will show here once Gold keeps one." />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="max-w-[16ch] font-heading text-3xl font-extrabold tracking-[-0.03em] md:text-4xl">Start exploring. Go deeper when you&apos;re ready.</h2>
        <p className="mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">
          Get started with gold-trading intelligence and choose the level of historical access and analysis you need.
        </p>
        <div className="mt-10 border-t border-primary/20">
          <article className="grid gap-4 border-b border-primary/40 py-7 md:grid-cols-[11rem_11rem_minmax(0,1fr)_auto] md:items-start md:gap-8">
            <div>
              <p className="mb-1 text-sm font-semibold text-win">One time</p>
              <h3 className="font-heading text-2xl font-extrabold tracking-tight text-win">10-day pass</h3>
            </div>
            <p className="font-heading text-3xl font-extrabold tabular-nums tracking-tight text-win">
              {fmtMoney(PASS_PRICE_CENTS, "usd")}
              <span className="font-sans text-sm font-normal text-muted-foreground"> once</span>
            </p>
            <div>
              <p className="text-sm text-foreground/75">Gold access for 10 days. One per account. Does not renew.</p>
              <ul className="mt-3 space-y-1 text-sm text-foreground/85">
                <li>The full Gold book</li>
                <li>Full historical access</li>
              </ul>
            </div>
            <PassButton used={passUsed} size="sm" label="Get the pass" />
          </article>
          {PAID.map((tier) => {
            const featured = tier === "gold";
            const plan = monthly.get(tier);
            return (
              <article
                key={tier}
                className={cn(
                  "grid gap-4 border-b border-primary/20 py-7 md:grid-cols-[11rem_11rem_minmax(0,1fr)_auto] md:items-start md:gap-8",
                  featured && "border-primary/40",
                )}
              >
                <div>
                  {featured && <p className="mb-1 text-sm font-semibold text-primary">Deeper access</p>}
                  <h3 className={cn("font-heading text-2xl font-extrabold tracking-tight", TIER_TYPE[tier])}>{TIER_LABEL[tier]}</h3>
                </div>
                <p className={cn("font-heading text-3xl font-extrabold tabular-nums tracking-tight", TIER_TYPE[tier])}>
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
                <Link href={`/pricing?tier=${tier}&period=monthly`} className={cn(buttonVariants({ variant: featured ? "default" : "outline", size: "sm" }), "w-fit")}>
                  Choose {TIER_LABEL[tier]}
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      <section id="referrals" className="border-y border-primary/15">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <p className="text-sm font-semibold tracking-[0.16em] text-primary uppercase">The GIG referral program</p>
          <h2 className="mt-3 max-w-[16ch] font-heading text-3xl font-extrabold tracking-[-0.03em] md:text-4xl">Share the intelligence. Earn every month.</h2>
          <p className="mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">
            Know other gold traders? Introduce them to Gold Intelligence Gateway and earn a commission each month they pay.
          </p>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {PAID.map((tier) => (
              <article key={tier} className="rounded-2xl border border-primary/20 bg-[#081328]/60 px-5 py-6">
                <p className={cn("font-heading text-4xl font-extrabold tabular-nums tracking-tight", TIER_TYPE[tier])}>
                  {fmtMoney(REFERRAL_FEE_CENTS[tier], "usd")}
                </p>
                <h3 className={cn("mt-2 font-heading text-xl font-extrabold tracking-tight", TIER_TYPE[tier])}>{TIER_LABEL[tier]}</h3>
                <p className="mt-1 text-sm text-muted-foreground">Per referral / month</p>
              </article>
            ))}
          </div>
          <h3 className="mt-12 max-w-[22ch] font-heading text-2xl font-extrabold tracking-tight">Three members on your plan cover that membership.</h3>
          <p className="mt-3 max-w-xl text-pretty leading-relaxed text-foreground/85">
            Refer three active, paying members on the same plan and the commissions equal that plan&apos;s price. The membership is paid for by what you earn.
          </p>
          <Link href={user ? "/referrals" : "/signup?next=%2Freferrals"} className={cn(buttonVariants({ size: "lg" }), "mt-6 w-fit px-6")}>
            Become a GIG Referral Partner <ArrowRight />
          </Link>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Commissions follow the lower of the two plans, and only when a full monthly price is collected. The 10-day pass does not earn a commission.
          </p>

          <ol className="mt-14 grid gap-8 md:grid-cols-3">
            <li>
              <p className="text-sm font-semibold text-primary">1</p>
              <h3 className="mt-2 font-heading text-lg font-extrabold tracking-tight">Get your referral link</h3>
              <p className="mt-2 text-sm leading-relaxed text-foreground/80">Every member gets a link to share with trading friends, Telegram communities, and other gold traders.</p>
            </li>
            <li>
              <p className="text-sm font-semibold text-primary">2</p>
              <h3 className="mt-2 font-heading text-lg font-extrabold tracking-tight">Earn one-third of a paid month</h3>
              <p className="mt-2 text-sm leading-relaxed text-foreground/80">
                {fmtMoney(REFERRAL_FEE_CENTS.basic, "usd")} for Basic, {fmtMoney(REFERRAL_FEE_CENTS.silver, "usd")} for Silver, or {fmtMoney(REFERRAL_FEE_CENTS.gold, "usd")} for Gold. The commission follows the lower plan.
              </p>
            </li>
            <li>
              <p className="text-sm font-semibold text-primary">3</p>
              <h3 className="mt-2 font-heading text-lg font-extrabold tracking-tight">Three members cover your plan</h3>
              <p className="mt-2 text-sm leading-relaxed text-foreground/80">Three paying members on the same plan earn that plan&apos;s price each month. Those commissions cover the membership.</p>
            </li>
          </ol>

          <div className="mt-14 max-w-xl">
            <h3 className="font-heading text-lg font-extrabold tracking-tight">What the commissions add up to</h3>
            <table className="mt-4 w-full text-sm">
              <thead>
                <tr className="border-b border-primary/20 text-left text-muted-foreground">
                  <th className="py-2 font-medium">Referrals on the same plan</th>
                  <th className="py-2 text-right font-medium">Monthly commissions</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["1 Basic member", REFERRAL_FEE_CENTS.basic],
                  ["3 Basic members", REFERRAL_FEE_CENTS.basic * 3],
                  ["3 Silver members", REFERRAL_FEE_CENTS.silver * 3],
                  ["3 Gold members", REFERRAL_FEE_CENTS.gold * 3],
                ].map(([label, cents]) => (
                  <tr key={label} className="border-b border-primary/15">
                    <td className="py-2.5">{label}</td>
                    <td className="py-2.5 text-right font-semibold tabular-nums">{fmtMoney(Number(cents), "usd")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Three referrals at the same plan level earn the cost of that plan. Share GIG and let those commissions cover your membership.
            </p>
          </div>
        </div>
      </section>

      <section className="border-b border-primary/15">
        <div className="mx-auto max-w-6xl px-4 py-20">
          <h2 className="max-w-[18ch] font-heading text-3xl font-extrabold tracking-[-0.03em] md:text-4xl">Intelligence you can examine. Not promises you have to believe.</h2>
          <p className="mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">
            Trading statistics are only useful when you understand how they were produced. Gold Intelligence Gateway is built around recorded signals, market data, and defined evaluation methods.
          </p>
          <ul className="mt-8 max-w-xl space-y-3 text-foreground/90">
            {TRUST.map((line) => (
              <li key={line} className="border-l border-primary/40 pl-4">
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-8 max-w-xl text-pretty leading-relaxed text-foreground/85">
            The goal is to help you evaluate the information, not ask you to trust another trading guru.
          </p>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Gold Intelligence Gateway provides general informational and analytical content, not personalized financial advice. Trading leveraged products carries substantial risk.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20">
        <h2 className="max-w-[16ch] font-heading text-3xl font-extrabold tracking-[-0.03em] md:text-4xl">Stop following blindly. Start looking at the evidence.</h2>
        <p className="mt-4 max-w-xl text-pretty leading-relaxed text-muted-foreground">
          You can keep relying on a handful of trading channels, or explore a much broader view of the gold-signal landscape. Compare sources. Examine historical results. Discover what the data says.
        </p>
        <p className="mt-6 max-w-xl font-heading text-xl font-extrabold tracking-tight">Gold Intelligence Gateway puts the evidence in front of you.</p>
        <div className="mt-8">
          <PassButton used={passUsed} size="lg" label="Get the 10-day pass" />
          <p className="mt-3 text-sm text-muted-foreground">{fmtMoney(PASS_PRICE_CENTS, "usd")} once for Gold access. One per account. It does not renew.</p>
        </div>
        <div className="mt-16">
          <AffiliateStrip placement="landing" />
        </div>
      </section>
    </>
  );
}
