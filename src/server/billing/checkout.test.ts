import { describe, expect, it } from "vitest";
import { completeMockCheckout, startCheckout, stopsAtPeriodEnd } from "./service";

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
