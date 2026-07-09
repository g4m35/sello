import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

vi.mock("server-only", () => ({}));

import { entitlementsForPlan, requirePlanFeature } from "./entitlements";

describe("entitlementsForPlan", () => {
  it("bundles the plan, limits, and features", () => {
    const ent = entitlementsForPlan("kingpin");
    expect(ent.plan).toBe("kingpin");
    expect(ent.limits.aiListingsPerMonth).toBe(1000);
    expect(ent.features.autoDelist).toBe(true);
    expect(entitlementsForPlan("free").features.autoDelist).toBe(false);
  });
});

describe("requirePlanFeature", () => {
  it("passes when the plan grants a boolean feature", () => {
    expect(() => requirePlanFeature(entitlementsForPlan("kingpin"), "fullInventorySync")).not.toThrow();
  });

  it("throws PLAN_FEATURE_REQUIRED when the plan lacks the feature", () => {
    try {
      requirePlanFeature(entitlementsForPlan("free"), "fullInventorySync");
      throw new Error("expected throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("PLAN_FEATURE_REQUIRED");
    }
  });

  it("treats profitTracking 'none' as not granted", () => {
    expect(() => requirePlanFeature(entitlementsForPlan("free"), "profitTracking")).toThrow();
    expect(() => requirePlanFeature(entitlementsForPlan("pro"), "profitTracking")).not.toThrow();
  });
});
