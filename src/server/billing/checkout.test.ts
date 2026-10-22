import { describe, expect, it } from "vitest";
import { billingMode } from "./config";
import { completeMockCheckout, startCheckout, stopsAtPeriodEnd } from "./service";

describe("billingMode", () => {
  it("refuses to fall back to mock billing in production unless ALLOW_MOCK_BILLING=1", () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevStripe = process.env.STRIPE_SECRET_KEY;
    const prevAllow = process.env.ALLOW_MOCK_BILLING;
    try {
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.ALLOW_MOCK_BILLING;
      (process.env as { NODE_ENV?: string }).NODE_ENV = "production";
      expect(billingMode()).toBe("stripe");
      process.env.ALLOW_MOCK_BILLING = "1";
      expect(billingMode()).toBe("mock");
    } finally {
      (process.env as { NODE_ENV?: string }).NODE_ENV = prevNodeEnv;
      if (prevStripe === undefined) delete process.env.STRIPE_SECRET_KEY;
      else process.env.STRIPE_SECRET_KEY = prevStripe;
      if (prevAllow === undefined) delete process.env.ALLOW_MOCK_BILLING;
      else process.env.ALLOW_MOCK_BILLING = prevAllow;
    }
  });
});

describe("startCheckout", () => {
  it("refuses a weekly or annual plan before any billing call", async () => {
    await expect(startCheckout({ id: "user", email: "a@example.com" }, "basic", "weekly")).rejects.toThrow(
      "Only monthly plans are offered.",
    );
    await expect(startCheckout({ id: "user", email: "a@example.com" }, "gold", "annual")).rejects.toThrow(
      "Only monthly plans are offered.",
    );
  });
});

describe("completeMockCheckout", () => {
  it("refuses a weekly or annual plan before creating a subscription", async () => {
    await expect(completeMockCheckout("user", "silver", "weekly")).rejects.toThrow("Only monthly plans are offered.");
    await expect(completeMockCheckout("user", "gold", "annual")).rejects.toThrow("Only monthly plans are offered.");
  });
});

describe("stopsAtPeriodEnd", () => {
  it("stops every weekly and annual subscription when the paid period ends", () => {
    expect(stopsAtPeriodEnd({ tier: "basic", period: "weekly" })).toBe(true);
    expect(stopsAtPeriodEnd({ tier: "silver", period: "annual" })).toBe(true);
    expect(stopsAtPeriodEnd({ tier: "gold", period: "weekly" })).toBe(true);
  });

  it("keeps renewing monthly plans", () => {
    expect(stopsAtPeriodEnd({ tier: "basic", period: "monthly" })).toBe(false);
    expect(stopsAtPeriodEnd({ tier: "silver", period: "monthly" })).toBe(false);
    expect(stopsAtPeriodEnd({ tier: "gold", period: "monthly" })).toBe(false);
  });
});
