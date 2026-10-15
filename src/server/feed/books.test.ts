import { describe, expect, it } from "vitest";
import { dashboardsFor, resolveDashboardView } from "./snapshot";

const gold = { isAdmin: false, tier: "gold" };
const silver = { isAdmin: false, tier: "silver" };
const basic = { isAdmin: false, tier: "basic" };

describe("dashboardsFor", () => {
  it("lets a member open their book and every book below it", () => {
    expect(dashboardsFor(gold)).toEqual(["gold", "silver", "basic"]);
    expect(dashboardsFor(silver)).toEqual(["silver", "basic"]);
    expect(dashboardsFor(basic)).toEqual(["basic"]);
  });

  it("keeps admin and visitors on a single book", () => {
    expect(dashboardsFor({ isAdmin: true, tier: "gold" })).toEqual(["admin"]);
    expect(dashboardsFor({ isAdmin: false, tier: null })).toEqual(["free"]);
  });
});

describe("resolveDashboardView", () => {
  it("opens a lower book when the member asks for it", () => {
    expect(resolveDashboardView(gold, "silver")).toBe("silver");
    expect(resolveDashboardView(gold, "basic")).toBe("basic");
    expect(resolveDashboardView(silver, "basic")).toBe("basic");
  });

  it("stays on the member's own book when the request is missing or above them", () => {
    expect(resolveDashboardView(gold, undefined)).toBe("gold");
    expect(resolveDashboardView(silver, "gold")).toBe("silver");
    expect(resolveDashboardView(basic, "silver")).toBe("basic");
    expect(resolveDashboardView(basic, "admin")).toBe("basic");
    expect(resolveDashboardView({ isAdmin: true, tier: "gold" }, "gold")).toBe("admin");
  });
});
