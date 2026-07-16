import { describe, expect, it, vi } from "vitest";

import {
  ADMIN_UNLIMITED_LIMIT,
  accountWithEffectivePlan,
  effectiveLimitsForUser,
  effectivePlanForUser,
  hasCommercialPlanAccess,
} from "./effective-plan";
import { limitsFor } from "./plans";

vi.mock("server-only", () => ({}));

describe("effectivePlanForUser", () => {
  it("keeps a normal user's account plan", () => {
    expect(
      effectivePlanForUser(
        { plan: "free" },
        { id: "user-1", email: "seller@example.com" },
        { ADMIN_EMAILS: "owner@example.com" },
      ),
    ).toBe("free");
  });

  it("surfaces kingpin for allow-listed admins without mutating the account", () => {
    const account = { id: "acc-1", plan: "free" as const };
    const effective = accountWithEffectivePlan(
      account,
      { id: "user-1", email: "owner@example.com" },
      { ADMIN_EMAILS: "owner@example.com" },
    );

    expect(effective).toEqual({ id: "acc-1", plan: "kingpin" });
    expect(account.plan).toBe("free");
  });

  it("gives admins unlimited numeric limits while free/pro/kingpin stay finite", () => {
    const env = { ADMIN_EMAILS: "owner@example.com" };
    const adminLimits = effectiveLimitsForUser(
      { plan: "free" },
      { email: "owner@example.com" },
      env,
    );
    expect(adminLimits.aiListingsPerMonth).toBe(ADMIN_UNLIMITED_LIMIT);
    expect(adminLimits.marketplaceConnections).toBe(ADMIN_UNLIMITED_LIMIT);
    expect(adminLimits.bulkBatchSize).toBe(ADMIN_UNLIMITED_LIMIT);

    expect(
      effectiveLimitsForUser({ plan: "free" }, { email: "seller@example.com" }, env),
    ).toEqual(limitsFor("free"));
    expect(
      effectiveLimitsForUser({ plan: "pro" }, { email: "seller@example.com" }, env),
    ).toEqual(limitsFor("pro"));
    expect(
      effectiveLimitsForUser({ plan: "kingpin" }, { email: "seller@example.com" }, env),
    ).toEqual(limitsFor("kingpin"));
  });

  it("downgrades paid plans outside active, trialing, or bounded past-due access", () => {
    const account = { plan: "pro" as const };
    const user = { email: "seller@example.com" };
    const env = { ADMIN_EMAILS: "owner@example.com" };
    const now = new Date("2026-07-15T12:00:00Z");

    for (const status of ["active", "trialing"] as const) {
      expect(effectivePlanForUser(account, user, env, {
        subscription: { status, graceEndsAt: null },
        now,
      })).toBe("pro");
    }
    expect(effectivePlanForUser(account, user, env, {
      subscription: {
        status: "past_due",
        graceEndsAt: new Date("2026-07-15T12:00:01Z"),
      },
      now,
    })).toBe("pro");

    for (const subscription of [
      null,
      { status: "canceled" as const, graceEndsAt: null },
      { status: "unpaid" as const, graceEndsAt: null },
      { status: "past_due" as const, graceEndsAt: new Date("2026-07-15T11:59:59Z") },
    ]) {
      expect(effectivePlanForUser(account, user, env, { subscription, now })).toBe("free");
      expect(effectiveLimitsForUser(account, user, env, { subscription, now })).toEqual(
        limitsFor("free"),
      );
    }
  });

  it("treats free accounts as commercially available without a subscription row", () => {
    expect(hasCommercialPlanAccess({ plan: "free" }, null)).toBe(true);
  });
});
