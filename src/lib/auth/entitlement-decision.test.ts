import { describe, expect, it } from "vitest";

import { decideEntitlement, type EntitlementDecisionInput } from "./entitlement-decision";

const base: EntitlementDecisionInput = {
  plan: "pro",
  accountEnabled: true,
  subscriptionRequired: true,
  subscriptionStatus: "active",
  planGranted: true,
  allowlistRequired: true,
  allowlisted: true,
  marketplaceApprovalRequired: true,
  marketplaceApproved: true,
  providerRequired: true,
  providerAvailable: true,
  environmentCapable: true,
  globalEnabled: true,
  featureEnabled: true,
  providerEnabled: true,
  now: new Date("2026-07-10T12:00:00Z"),
};

describe("decideEntitlement", () => {
  it("allows only when every applicable gate passes", () => {
    expect(decideEntitlement(base)).toMatchObject({
      allowed: true,
      reason: "ALLOWED",
      adminOverrideApplied: false,
    });
  });

  it.each([
    ["accountEnabled", false, "ACCOUNT_DISABLED"],
    ["globalEnabled", false, "GLOBAL_KILL_SWITCH_ACTIVE"],
    ["featureEnabled", false, "FEATURE_KILL_SWITCH_ACTIVE"],
    ["providerEnabled", false, "PROVIDER_KILL_SWITCH_ACTIVE"],
    ["environmentCapable", false, "ENVIRONMENT_CAPABILITY_UNAVAILABLE"],
    ["providerAvailable", false, "PROVIDER_UNAVAILABLE"],
    ["marketplaceApproved", false, "MARKETPLACE_APPROVAL_REQUIRED"],
    ["planGranted", false, "PLAN_FEATURE_REQUIRED"],
    ["allowlisted", false, "ALPHA_OR_BETA_ACCESS_REQUIRED"],
  ] as const)("returns %s denial as %s", (field, value, reason) => {
    expect(decideEntitlement({ ...base, [field]: value })).toMatchObject({
      allowed: false,
      reason,
    });
  });

  it("accepts active/trialing subscriptions and an unexpired grace period", () => {
    expect(decideEntitlement({ ...base, subscriptionStatus: "trialing" }).allowed).toBe(true);
    expect(
      decideEntitlement({
        ...base,
        subscriptionStatus: "past_due",
        graceEndsAt: new Date("2026-07-11T00:00:00Z"),
      }),
    ).toMatchObject({ allowed: true, gracePeriodActive: true });
  });

  it.each(["past_due", "canceled", "unpaid", "incomplete"] as const)(
    "fails closed for %s outside grace",
    (subscriptionStatus) => {
      expect(
        decideEntitlement({
          ...base,
          subscriptionStatus,
          graceEndsAt: new Date("2026-07-09T00:00:00Z"),
        }),
      ).toMatchObject({ allowed: false, reason: "SUBSCRIPTION_INACTIVE" });
    },
  );

  it("lets admin bypass commercial and allowlist gates", () => {
    expect(
      decideEntitlement({
        ...base,
        adminOverride: true,
        subscriptionStatus: "canceled",
        planGranted: false,
        allowlisted: false,
      }),
    ).toMatchObject({ allowed: true, adminOverrideApplied: true });
  });

  it.each([
    ["accountEnabled", false, "ACCOUNT_DISABLED"],
    ["globalEnabled", false, "GLOBAL_KILL_SWITCH_ACTIVE"],
    ["featureEnabled", false, "FEATURE_KILL_SWITCH_ACTIVE"],
    ["providerEnabled", false, "PROVIDER_KILL_SWITCH_ACTIVE"],
    ["environmentCapable", false, "ENVIRONMENT_CAPABILITY_UNAVAILABLE"],
    ["providerAvailable", false, "PROVIDER_UNAVAILABLE"],
    ["marketplaceApproved", false, "MARKETPLACE_APPROVAL_REQUIRED"],
  ] as const)("does not let admin bypass %s", (field, value, reason) => {
    expect(
      decideEntitlement({ ...base, adminOverride: true, [field]: value }),
    ).toMatchObject({ allowed: false, reason });
  });

  it("always returns seller-safe copy without configuration details", () => {
    const decisions = [
      decideEntitlement({ ...base, globalEnabled: false }),
      decideEntitlement({ ...base, allowlisted: false }),
      decideEntitlement({ ...base, providerAvailable: false }),
    ];
    for (const decision of decisions) {
      expect(decision.sellerCopy).not.toMatch(/env|email|token|secret|ADMIN_/i);
    }
  });
});
