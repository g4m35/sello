import { describe, expect, it } from "vitest";

import { PLAN_CATALOG, featuresFor, limitsFor, planForPriceId } from "./plans";

describe("plan catalog", () => {
  it("encodes the approved limits", () => {
    expect(limitsFor("free").aiListingsPerMonth).toBe(10);
    expect(limitsFor("pro").aiListingsPerMonth).toBe(125);
    expect(limitsFor("kingpin").aiListingsPerMonth).toBe(1000);
    expect(limitsFor("pro").marketplaceConnections).toBe(3);
    expect(limitsFor("kingpin").bulkBatchSize).toBe(250);
    expect(limitsFor("kingpin").teamSeats).toBe(5);
    expect(limitsFor("free").bulkBatchSize).toBe(5);
  });

  it("encodes prices in cents", () => {
    expect(PLAN_CATALOG.free.priceCents).toBe(0);
    expect(PLAN_CATALOG.pro.priceCents).toBe(2000);
    expect(PLAN_CATALOG.kingpin.priceCents).toBe(11900);
  });

  it("gates kingpin-only features", () => {
    expect(featuresFor("pro").fullInventorySync).toBe(false);
    expect(featuresFor("kingpin").fullInventorySync).toBe(true);
    expect(featuresFor("free").basicAnalytics).toBe(false);
    expect(featuresFor("pro").basicAnalytics).toBe(true);
    expect(featuresFor("kingpin").profitTracking).toBe("advanced");
    expect(featuresFor("pro").profitTracking).toBe("simple");
    expect(featuresFor("free").profitTracking).toBe("none");
  });

  it("maps a stripe price id back to its plan", () => {
    const env = { STRIPE_PRICE_PRO: "price_pro", STRIPE_PRICE_KINGPIN: "price_king" };
    expect(planForPriceId("price_pro", env)).toBe("pro");
    expect(planForPriceId("price_king", env)).toBe("kingpin");
    expect(planForPriceId("price_unknown", env)).toBeNull();
  });

  it("does not map an empty/undefined price id to a plan", () => {
    expect(planForPriceId("", { STRIPE_PRICE_PRO: "" })).toBeNull();
  });
});
