import { describe, expect, it, vi } from "vitest";

import {
  ADMIN_UNLIMITED_LIMIT,
  accountWithEffectivePlan,
  effectiveLimitsForUser,
  effectivePlanForUser,
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
});
