import { describe, expect, it } from "vitest";
import { can } from "./access";
import { DEFAULT_TIER_CONFIG } from "./config";
import { accessForMember, LEGACY_TRIAL_CUTOFF, PASS_MS, showTrialBanner, TRIAL_MS } from "./trial";

const config = DEFAULT_TIER_CONFIG;
const legacyCreatedAt = new Date(LEGACY_TRIAL_CUTOFF.getTime() - 86_400_000);
const newAccount = new Date(LEGACY_TRIAL_CUTOFF.getTime() + 86_400_000);
const during = new Date(legacyCreatedAt.getTime() + TRIAL_MS - 1000);
const after = new Date(legacyCreatedAt.getTime() + TRIAL_MS + 1000);

describe("trial access", () => {
  it("shows free access during the trial when no plan is chosen", () => {
    const access = accessForMember({ createdAt: legacyCreatedAt, now: during, subscription: null, config });
    expect(access.tier).toBeNull();
    expect(can(access, "signals.core")).toBe(true);
    expect(can(access, "signals.levels")).toBe(false);
    expect(can(access, "signals.basic_result")).toBe(false);
    expect(access.historyDays).toBe(7);
  });

  it("keeps the call visible and locks stops, targets, and history after the trial", () => {
    const access = accessForMember({ createdAt: legacyCreatedAt, now: after, subscription: null, config });
    expect(can(access, "signals.core")).toBe(true);
    expect(can(access, "signals.levels")).toBe(false);
    expect(can(access, "signals.basic_result")).toBe(false);
  });

  it("keeps basic access when basic is chosen during the trial", () => {
    const access = accessForMember({
      createdAt: legacyCreatedAt,
      now: during,
      subscription: { tier: "basic" },
      config,
    });
    expect(access.tier).toBe("basic");
    expect(access.historyDays).toBe(7);
    expect(can(access, "sources.stats.summary")).toBe(false);
  });

  it("grants gold for the rest of the trial when the chosen plan is silver", () => {
    const access = accessForMember({
      createdAt: legacyCreatedAt,
      now: during,
      subscription: { tier: "silver" },
      config,
    });
    expect(access.tier).toBe("gold");
    expect(access.historyDays).toBeNull();
  });

  it("uses the chosen plan once the trial has ended", () => {
    const access = accessForMember({
      createdAt: legacyCreatedAt,
      now: after,
      subscription: { tier: "silver" },
      config,
    });
    expect(access.tier).toBe("silver");
    expect(access.historyDays).toBe(180);
  });

  it("uses a complimentary grant when nothing is paid", () => {
    const access = accessForMember({ createdAt: legacyCreatedAt, now: after, subscription: null, complimentary: "gold", config });
    expect(access.tier).toBe("gold");
  });

  it("lets complimentary gold outrank a paid silver plan after the trial", () => {
    const access = accessForMember({
      createdAt: legacyCreatedAt,
      now: after,
      subscription: { tier: "silver" },
      complimentary: "gold",
      config,
    });
    expect(access.tier).toBe("gold");
    expect(access.historyDays).toBeNull();
  });

  it("ignores a complimentary grant that is not higher than the paid plan", () => {
    const same = accessForMember({ createdAt: legacyCreatedAt, now: after, subscription: { tier: "silver" }, complimentary: "silver", config });
    const lower = accessForMember({ createdAt: legacyCreatedAt, now: after, subscription: { tier: "gold" }, complimentary: "silver", config });
    expect(same.tier).toBe("silver");
    expect(lower.tier).toBe("gold");
  });

  it("applies complimentary gold during the trial when no plan is chosen", () => {
    const access = accessForMember({ createdAt: legacyCreatedAt, now: during, subscription: null, complimentary: "gold", config });
    expect(access.tier).toBe("gold");
  });

  it("gives a new account the free call book when it has no pass and no plan", () => {
    const access = accessForMember({
      createdAt: newAccount,
      now: new Date(newAccount.getTime() + 1000),
      subscription: null,
      passEndsAt: null,
      config,
    });
    expect(can(access, "signals.core")).toBe(true);
    expect(can(access, "signals.levels")).toBe(false);
    expect(can(access, "signals.basic_result")).toBe(false);
  });

  it("grants gold until the pass ends, even with a basic subscription", () => {
    const now = new Date("2026-10-20T00:00:00.000Z");
    const access = accessForMember({
      createdAt: newAccount,
      now,
      subscription: { tier: "basic" },
      passEndsAt: new Date(now.getTime() + PASS_MS),
      config,
    });
    expect(access.tier).toBe("gold");
    expect(access.historyDays).toBeNull();
  });

  it("uses the subscription after the pass ends", () => {
    const now = new Date("2026-10-20T00:00:00.000Z");
    const access = accessForMember({
      createdAt: newAccount,
      now,
      subscription: { tier: "basic" },
      passEndsAt: new Date(now.getTime() - 1000),
      config,
    });
    expect(access.tier).toBe("basic");
  });
});

it("shows the banner until a plan is chosen, and only during the trial", () => {
  expect(showTrialBanner({ createdAt: legacyCreatedAt, now: during, hasPlan: false })).toBe(true);
  expect(showTrialBanner({ createdAt: legacyCreatedAt, now: during, hasPlan: true })).toBe(false);
  expect(showTrialBanner({ createdAt: legacyCreatedAt, now: after, hasPlan: false })).toBe(false);
});
