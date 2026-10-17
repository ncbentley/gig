import { BarChart3, CalendarClock, Package, Radio, Timer } from "lucide-react";
import type { Metadata } from "next";
import { buyPassAction } from "@/app/actions/billing";
import { AffiliateStrip } from "@/components/affiliate-strip";
import { PageHeader } from "@/components/page-header";
import { parsePlanParams, PlanPicker } from "@/components/plan-picker";
import { buttonVariants } from "@/components/ui/button";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { billingMode } from "@/server/billing/config";
import { getCurrentUser } from "@/server/auth";
import { PASS_PRICE_CENTS, purchasedPass } from "@/server/billing/pass";

export const metadata: Metadata = { title: "Pricing" };

const FEATURES = [
  { icon: Radio, label: "10-day Gold pass" },
  { icon: Timer, label: "Available, Active, and History" },
  { icon: BarChart3, label: "Source track records" },
  { icon: CalendarClock, label: "Cancel any time" },
];

export default async function PricingPage({ searchParams }: PageProps<"/pricing">) {
  const { period, highlight } = parsePlanParams(await searchParams);
  const user = await getCurrentUser();
  const passUsed = user ? Boolean(await purchasedPass(user.id)) : false;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:py-10">
      <PageHeader
        icon={Package}
        title="Choose your package"
        description="Basic is every signal for 7 days. Silver and Gold are tighter readings of the same calls. The 10-day pass is Gold access, one purchase per account."
        features={FEATURES}
      />

      <p className="mt-7 max-w-2xl text-sm leading-relaxed text-muted-foreground">
        Monthly plans renew until you cancel. The 10-day pass is one purchase per account and does not renew.
      </p>

      <article className="mt-8 flex flex-col gap-4 rounded-2xl px-6 py-6 ring-1 ring-primary/55 panel-gold sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-xl font-extrabold tracking-tight">10-day full-access pass</h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-foreground/80">
            {fmtMoney(PASS_PRICE_CENTS, "usd")} once for 10 days of Gold access, including full history. One per account. It does not renew.
          </p>
        </div>
        {passUsed ? (
          <p className="text-sm text-muted-foreground">This account already used its 10-day pass.</p>
        ) : (
          <form action={buyPassAction}>
            <button type="submit" className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}>
              Get the pass
            </button>
          </form>
        )}
      </article>

      <div className="mt-6">
        <PlanPicker period={period} highlight={highlight} basePath="/pricing" />
      </div>

      <div className="mt-8 space-y-1 text-center text-xs text-muted-foreground">
        <p>Prices in USD. Subscriptions renew automatically until cancelled; cancelling keeps access until the end of the paid period.</p>
        {billingMode() === "mock" && <p className="text-amber-300/80">Billing is running in test mode. Checkout completes without a real payment.</p>}
        <p>Signals and statistics are general information, not personal financial advice. Past results do not guarantee future performance.</p>
      </div>

      <div className="mt-10">
        <AffiliateStrip placement="pricing" />
      </div>
    </div>
  );
}
