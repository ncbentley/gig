import { cookies } from "next/headers";
import { cache } from "react";
import { getCurrentUser } from "@/server/auth";
import { getEntitledSubscription } from "@/server/billing/service";
import { getDb } from "@/server/db";
import { and, desc, eq } from "drizzle-orm";
import { accessPasses, tierEntitlements, TIERS, type Tier, type User } from "@/server/db/schema";
import { ANONYMOUS, buildAccess, type Access } from "./access";
import { ALL_FEATURES, DEFAULT_TIER_CONFIG, type Feature, type TierConfig } from "./config";
import { getComplimentaryTier } from "./grants";
import { accessForMember } from "./trial";
import { accessForPreview, parseViewAs, VIEW_AS_COOKIE, type ViewAs } from "./view-as";

export async function getTierConfig(): Promise<Record<Tier, TierConfig>> {
  const db = await getDb();
  const rows = await db.select().from(tierEntitlements);
  const config = structuredClone(DEFAULT_TIER_CONFIG);
  for (const row of rows) {
    config[row.tier] = {
      features: row.features.filter((f): f is Feature => (ALL_FEATURES as string[]).includes(f)),
      historyDays: row.historyDays,
    };
  }
  return config;
}

export async function saveTierConfig(tier: Tier, value: TierConfig) {
  if (!TIERS.includes(tier)) throw new Error("Unknown tier");
  const db = await getDb();
  await db
    .insert(tierEntitlements)
    .values({ tier, features: value.features, historyDays: value.historyDays })
    .onConflictDoUpdate({ target: tierEntitlements.tier, set: { features: value.features, historyDays: value.historyDays } });
}

export async function accessForUser(user: User | null, config?: Record<Tier, TierConfig>): Promise<Access> {
  const cfg = config ?? (await getTierConfig());
  if (!user) return ANONYMOUS;
  if (user.role === "admin") return buildAccess(null, cfg, true);
  const db = await getDb();
  const [sub, complimentary, [pass]] = await Promise.all([
    getEntitledSubscription(user.id),
    getComplimentaryTier(user.id),
    db
      .select({ endsAt: accessPasses.endsAt })
      .from(accessPasses)
      .where(and(eq(accessPasses.userId, user.id), eq(accessPasses.status, "paid")))
      .orderBy(desc(accessPasses.endsAt))
      .limit(1),
  ]);
  return accessForMember({
    createdAt: user.createdAt,
    now: new Date(),
    subscription: sub,
    complimentary,
    passEndsAt: pass?.endsAt ?? null,
    config: cfg,
  });
}

export interface Viewer {
  user: User | null;
  access: Access;
  config: Record<Tier, TierConfig>;
  subscription: Awaited<ReturnType<typeof getEntitledSubscription>>;
  /** Stored complimentary tier, including one that does not outrank a paid plan. */
  complimentary: Tier | null;
  /** Set only for an admin who is previewing a membership. Admin tools ignore it. */
  viewAs: ViewAs | null;
}

/**
 * Viewer for a user already resolved by the caller. `viewAs` is only applied for
 * an admin, and only when the caller supplies it. Bearer auth passes nothing here
 * so a website preview cookie cannot downgrade that session.
 */
export async function viewerForUser(
  user: User | null,
  options: { scope?: "member" | "admin"; viewAs?: ViewAs | null } = {},
): Promise<Viewer> {
  const scope = options.scope ?? "member";
  const config = await getTierConfig();
  const db = await getDb();
  const [subscription, complimentary, [pass]] = user
    ? await Promise.all([
        getEntitledSubscription(user.id),
        getComplimentaryTier(user.id),
        db
          .select({ endsAt: accessPasses.endsAt })
          .from(accessPasses)
          .where(and(eq(accessPasses.userId, user.id), eq(accessPasses.status, "paid")))
          .orderBy(desc(accessPasses.endsAt))
          .limit(1),
      ])
    : [null, null, [] as { endsAt: Date }[]];
  const requested = user?.role === "admin" ? (options.viewAs ?? null) : null;
  const viewAs = scope === "member" ? requested : null;
  const access =
    user?.role === "admin"
      ? accessForPreview(config, viewAs)
      : user
        ? accessForMember({
            createdAt: user.createdAt,
            now: new Date(),
            subscription,
            complimentary,
            passEndsAt: pass?.endsAt ?? null,
            config,
          })
        : ANONYMOUS;
  return { user, access, config, subscription, complimentary, viewAs: requested };
}

/**
 * Per-request viewer context. Member pages and the member API honor an admin's
 * view-as choice. Pass "admin" from admin screens so previewing Silver does not
 * hide the operator's own tools.
 */
export const getViewer = cache(async (scope: "member" | "admin" = "member"): Promise<Viewer> => {
  const user = await getCurrentUser();
  const viewAs = user?.role === "admin" ? parseViewAs((await cookies()).get(VIEW_AS_COOKIE)?.value) : null;
  return viewerForUser(user, { scope, viewAs });
});
