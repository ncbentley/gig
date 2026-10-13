import type { Tier } from "@/server/db/schema";
import { ANONYMOUS, buildAccess, freeAccess, type Access } from "./access";
import { appliedComplimentary } from "./complimentary";
import type { TierConfig } from "./config";

export const TRIAL_MS = 7 * 24 * 60 * 60 * 1000;
export const PASS_MS = 10 * 24 * 60 * 60 * 1000;
export const LEGACY_TRIAL_CUTOFF = new Date("2026-10-13T00:00:00.000Z");

export function trialEndsAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + TRIAL_MS);
}

function inTrial(createdAt: Date, now: Date): boolean {
  return createdAt < LEGACY_TRIAL_CUTOFF && now < trialEndsAt(createdAt);
}

export function showTrialBanner(input: { createdAt: Date; now: Date; hasPlan: boolean }): boolean {
  const { createdAt, now, hasPlan } = input;
  return !hasPlan && inTrial(createdAt, now);
}

export function accessForMember(input: {
  createdAt: Date;
  now: Date;
  subscription: { tier: Tier } | null;
  complimentary?: Tier | null;
  passEndsAt?: Date | null;
  config: Record<Tier, TierConfig>;
}): Access {
  const { createdAt, now, subscription, config, passEndsAt } = input;
  if (passEndsAt && passEndsAt > now) return buildAccess("gold", config);
  const grant = appliedComplimentary(subscription?.tier ?? null, input.complimentary ?? null);
  if (subscription) {
    if (inTrial(createdAt, now) && subscription.tier !== "basic") return buildAccess("gold", config);
    if (grant) return buildAccess(grant, config);
    return buildAccess(subscription.tier, config);
  }
  if (grant) return buildAccess(grant, config);
  if (inTrial(createdAt, now)) return freeAccess();
  return ANONYMOUS;
}
