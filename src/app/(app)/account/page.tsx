import { and, eq, isNull } from "drizzle-orm";
import { CalendarDays, Check, Crown, KeyRound, LogOut, Mail, ShieldCheck, UserRound } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { disconnectTelegramAction } from "@/app/actions/telegram-link";
import { PageHeader } from "@/components/page-header";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fmtDate, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { requireUser } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { telegramLinks } from "@/server/db/schema";
import { FEATURE_CATALOG, historyWindowLabel, TIER_LABEL } from "@/server/entitlements/config";
import { appliedComplimentary } from "@/server/entitlements/complimentary";
import { getViewer } from "@/server/entitlements/service";
import { TELEGRAM_LINK_STATE_HEADER } from "@/server/telegram/link-state";

export const metadata: Metadata = { title: "My profile" };

const TELEGRAM_NOTE: Record<string, string> = {
  connected: "Telegram is connected.",
  taken: "That Telegram account is already linked to another member.",
  already: "This account is already linked to a different Telegram user.",
  invalid: "That Telegram login could not be verified.",
  unconfigured: "Telegram linking is not configured.",
  disconnected: "Telegram has been disconnected.",
};

function Row({ icon: IconCmp, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-black/25 px-3 py-2.5 ring-1 ring-glow/20">
      <IconCmp className="size-4 shrink-0 text-[#8db6ff]" />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto min-w-0 text-right font-medium [overflow-wrap:anywhere]">{children}</span>
    </div>
  );
}

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const user = await requireUser("/account");
  const sp = await searchParams;
  const telegramNote = typeof sp.telegram === "string" ? TELEGRAM_NOTE[sp.telegram] : undefined;
  const botToken = process.env.TELEGRAM_LINK_BOT_TOKEN;
  const botUsername = process.env.TELEGRAM_LINK_BOT_USERNAME;
  const linkState = (await headers()).get(TELEGRAM_LINK_STATE_HEADER);
  const telegramReady = Boolean(botToken && botUsername);
  const db = await getDb();
  const [telegramLink] = telegramReady
    ? await db
        .select()
        .from(telegramLinks)
        .where(and(eq(telegramLinks.userId, user.id), isNull(telegramLinks.revokedAt)))
        .limit(1)
    : [];
  const { access, subscription, viewAs, complimentary } = await getViewer();
  const applied = user.role === "admin" ? null : appliedComplimentary(subscription?.tier ?? null, complimentary);
  const hasAccess = access.features.size > 0;
  return (
    <>
      <PageHeader icon={UserRound} size="sm" title="My profile" description="Your account and membership details." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="rounded-2xl [--card-spacing:--spacing(5)]">
          <CardHeader>
            <CardTitle className="text-lg">Profile overview</CardTitle>
            <CardDescription>We store only what is needed to run your membership.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
              <span
                aria-hidden
                className="gold-fill flex size-24 shrink-0 items-center justify-center self-center rounded-full font-heading text-3xl font-extrabold shadow-[0_0_28px_-4px_rgb(245_197_66/0.7)] ring-4 ring-primary/25 sm:self-start"
              >
                {initials(user.email)}
              </span>
              <div className="min-w-0 flex-1 space-y-2">
                <Row icon={Mail} label="Email">
                  {user.email}
                </Row>
                <Row icon={ShieldCheck} label="Email status">
                  {user.emailVerifiedAt ? (
                    <span className="inline-flex rounded-full border border-win/45 bg-win/10 px-2.5 py-0.5 text-xs font-semibold text-win">Verified</span>
                  ) : (
                    <span className="inline-flex rounded-full border border-amber-400/40 bg-amber-400/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300">Unverified</span>
                  )}
                </Row>
                <Row icon={UserRound} label="Role">
                  <span className="capitalize">{user.role}</span>
                </Row>
                <Row icon={CalendarDays} label="Member since">
                  {fmtDate(user.createdAt)}
                </Row>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link href="/forgot-password" className={buttonVariants({ variant: "outline", size: "sm" })}>
                <KeyRound />
                Change password
              </Link>
              <form action={logoutAction}>
                <Button type="submit" variant="ghost" size="sm">
                  <LogOut />
                  Sign out
                </Button>
              </form>
            </div>
            <div className="mt-5 space-y-3">
              {telegramNote ? (
                <p role="status" className="text-sm text-foreground">
                  {telegramNote}
                </p>
              ) : null}
              {!botToken || !botUsername ? (
                <p className="text-sm text-muted-foreground">Telegram linking is not available yet.</p>
              ) : telegramLink ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="text-sm font-medium">
                    Connected to Telegram
                    {telegramLink.telegramUsername ? ` @${telegramLink.telegramUsername}` : ""}
                  </p>
                  <form action={disconnectTelegramAction}>
                    <Button type="submit" variant="outline" size="sm">
                      Disconnect
                    </Button>
                  </form>
                </div>
              ) : linkState ? (
                <script
                  async
                  src="https://telegram.org/js/telegram-widget.js?22"
                  data-telegram-login={botUsername}
                  data-size="large"
                  data-auth-url={`${process.env.APP_URL ?? ""}/api/telegram/link/${encodeURIComponent(linkState)}`}
                />
              ) : null}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              We never ask for brokerage credentials, account balances or positions. The product does not personalise information to your finances.
            </p>
          </CardContent>
        </Card>
        <Card className={cn("rounded-2xl [--card-spacing:--spacing(5)]", hasAccess && "panel-gold shadow-[0_0_28px_-8px_rgb(245_197_66/0.55)] ring-primary/55")}>
          <CardHeader>
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "flex size-11 shrink-0 items-center justify-center rounded-full ring-2",
                  hasAccess ? "bg-black/40 text-primary shadow-[0_0_18px_-2px_rgb(245_197_66/0.6)] ring-primary/70" : "bg-glow/10 text-[#8db6ff] ring-glow/55",
                )}
              >
                <Crown className="size-5" />
              </span>
              <div className="min-w-0">
                <CardTitle className={cn("text-lg", hasAccess && "gold-text")}>Your access</CardTitle>
                <CardDescription>
                  {viewAs === "none"
                    ? "Previewing a visitor with no plan."
                    : viewAs
                      ? `Previewing the ${TIER_LABEL[viewAs]} membership.`
                      : user.role === "admin"
                        ? "Administrators can see everything."
                        : applied
                          ? `Complimentary ${TIER_LABEL[applied]} access`
                          : subscription
                            ? `${TIER_LABEL[subscription.tier]} membership`
                            : "No active membership"}
                  {access.tier ? ` · ${historyWindowLabel(access.historyDays)}` : ""}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {hasAccess ? (
              <ul className="grid gap-2 text-sm sm:grid-cols-2">
                {[...access.features].map((f) => (
                  <li key={f} className="flex gap-2.5">
                    <span className="mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/50">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                    <span className="text-foreground/90">{FEATURE_CATALOG[f]}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <Link href="/billing#plans" className={buttonVariants()}>Choose a plan</Link>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
