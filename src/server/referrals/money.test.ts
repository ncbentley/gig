import { describe, expect, it } from "vitest";
import { allocateFifo, feeForPayment, feeLabel, requestableBalance, reverseFee } from "./money";

describe("feeForPayment", () => {
  it("pays one third of the lower level when the catalog price was collected", () => {
    expect(
      feeForPayment({
        collectedCents: 9900,
        customerCatalogCents: 9900,
        referrerTier: "basic",
        customerTier: "gold",
        referrerEligible: true,
      }),
    ).toBe(1100);
    expect(
      feeForPayment({
        collectedCents: 6600,
        customerCatalogCents: 6600,
        referrerTier: "gold",
        customerTier: "silver",
        referrerEligible: true,
      }),
    ).toBe(2200);
    expect(
      feeForPayment({
        collectedCents: 9900,
        customerCatalogCents: 9900,
        referrerTier: "gold",
        customerTier: "gold",
        referrerEligible: true,
      }),
    ).toBe(3300);
  });

  it("pays nothing on a prorated amount, an ineligible referrer, or a mismatched catalog price", () => {
    expect(
      feeForPayment({
        collectedCents: 2000,
        customerCatalogCents: 9900,
        referrerTier: "gold",
        customerTier: "gold",
        referrerEligible: true,
      }),
    ).toBeNull();
    expect(
      feeForPayment({
        collectedCents: 3300,
        customerCatalogCents: 3300,
        referrerTier: "basic",
        customerTier: "basic",
        referrerEligible: false,
      }),
    ).toBeNull();
  });
});

describe("reverseFee", () => {
  it("voids the unallocated remainder and claws back the sent portion", () => {
    expect(reverseFee({ amountCents: 2200, voidedCents: 0, allocatedCents: 1400 })).toEqual({
      voidedCents: 800,
      clawbackCents: 1400,
    });
  });
});

describe("requestableBalance", () => {
  it("subtracts voids, adjustments, sent transfers, and pending holds", () => {
    expect(
      requestableBalance({
        fees: [{ amountCents: 3300, voidedCents: 1100 }],
        adjustmentsCents: -1400,
        sentCents: 1400,
        pendingCents: 500,
      }),
    ).toBe(-1100);
  });
});

describe("feeLabel", () => {
  it('returns "reversed after payout" when clawed back', () => {
    expect(
      feeLabel({ amountCents: 2200, voidedCents: 800, allocatedCents: 1400, clawedBackCents: 1400 }),
    ).toBe("reversed after payout");
  });

  it('returns "voided" when fully voided and nothing allocated', () => {
    expect(feeLabel({ amountCents: 1100, voidedCents: 1100, allocatedCents: 0, clawedBackCents: 0 })).toBe(
      "voided",
    );
  });

  it('returns "paid out" when fully allocated and not voided', () => {
    expect(feeLabel({ amountCents: 3300, voidedCents: 0, allocatedCents: 3300, clawedBackCents: 0 })).toBe(
      "paid out",
    );
  });

  it('returns "open" otherwise', () => {
    expect(feeLabel({ amountCents: 2200, voidedCents: 0, allocatedCents: 1400, clawedBackCents: 0 })).toBe(
      "open",
    );
  });
});

describe("allocateFifo", () => {
  it("splits the newest fee after the older one is consumed", () => {
    expect(
      allocateFifo(
        [
          { id: "new", createdAt: 2, amountCents: 2200, voidedCents: 0, allocatedCents: 0 },
          { id: "old", createdAt: 1, amountCents: 1100, voidedCents: 0, allocatedCents: 0 },
        ],
        2500,
      ),
    ).toEqual([
      { feeId: "old", cents: 1100 },
      { feeId: "new", cents: 1400 },
    ]);
  });

  it("refuses to allocate more than the open cents", () => {
    expect(() =>
      allocateFifo([{ id: "only", createdAt: 1, amountCents: 1100, voidedCents: 0, allocatedCents: 0 }], 2500),
    ).toThrow("Withdrawal exceeds open fees");
  });
});
