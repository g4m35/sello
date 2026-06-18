import { describe, expect, it } from "vitest";

import {
  evaluatePaidProviderGate,
  loadPaidGateConfig,
  utcDayStart,
  utcMonthStart,
  type PaidGateConfig,
  type PaidGateUsage,
} from "@/lib/comps/provider-budget";

const baseConfig: PaidGateConfig = {
  paidProvidersEnabled: true,
  adminOverride: false,
  dailyBudgetCents: 500,
  userDailyLimit: 25,
  userMonthlyLimit: 300,
  draftCooldownSeconds: 600,
  estimatedCostCents: 35,
};

const freshUsage: PaidGateUsage = {
  globalSpentTodayCents: 0,
  userCallsToday: 0,
  userCallsThisMonth: 0,
  lastDraftCallAt: null,
};

const now = new Date("2026-06-18T12:00:00.000Z");

function gate(config: Partial<PaidGateConfig>, usage: Partial<PaidGateUsage> = {}) {
  return evaluatePaidProviderGate({
    config: { ...baseConfig, ...config },
    usage: { ...freshUsage, ...usage },
    now,
  });
}

describe("evaluatePaidProviderGate", () => {
  it("allows a fresh call within all limits", () => {
    expect(gate({})).toEqual({ allowed: true });
  });

  it("blocks when the emergency kill switch is off (even with admin override)", () => {
    expect(gate({ paidProvidersEnabled: false })).toEqual({
      allowed: false,
      reason: "paid_providers_disabled",
    });
    expect(gate({ paidProvidersEnabled: false, adminOverride: true })).toEqual({
      allowed: false,
      reason: "paid_providers_disabled",
    });
  });

  it("admin override bypasses budget and quota (but not the kill switch)", () => {
    expect(
      gate(
        { adminOverride: true },
        { globalSpentTodayCents: 10_000, userCallsToday: 999, userCallsThisMonth: 9999 },
      ),
    ).toEqual({ allowed: true });
  });

  it("blocks when the next call would exceed the global daily budget", () => {
    expect(gate({ dailyBudgetCents: 500 }, { globalSpentTodayCents: 480 })).toEqual({
      allowed: false,
      reason: "global_budget_exceeded",
    });
    // 465 + 35 = 500, exactly at budget -> still allowed.
    expect(gate({ dailyBudgetCents: 500 }, { globalSpentTodayCents: 465 })).toEqual({
      allowed: true,
    });
  });

  it("blocks when the per-user daily quota is reached", () => {
    expect(gate({ userDailyLimit: 25 }, { userCallsToday: 25 })).toEqual({
      allowed: false,
      reason: "user_daily_quota_exceeded",
    });
  });

  it("blocks when the per-user monthly quota is reached", () => {
    expect(gate({ userMonthlyLimit: 300 }, { userCallsThisMonth: 300 })).toEqual({
      allowed: false,
      reason: "user_monthly_quota_exceeded",
    });
  });

  it("blocks while the per-draft cooldown is active and allows after it elapses", () => {
    expect(
      gate(
        { draftCooldownSeconds: 600 },
        { lastDraftCallAt: new Date(now.getTime() - 60_000) },
      ),
    ).toEqual({ allowed: false, reason: "draft_cooldown_active" });

    expect(
      gate(
        { draftCooldownSeconds: 600 },
        { lastDraftCallAt: new Date(now.getTime() - 601_000) },
      ),
    ).toEqual({ allowed: true });
  });
});

describe("loadPaidGateConfig", () => {
  it("reads env with safe defaults", () => {
    const config = loadPaidGateConfig({});
    expect(config.paidProvidersEnabled).toBe(false);
    expect(config.dailyBudgetCents).toBe(500);
    expect(config.estimatedCostCents).toBe(35);
  });
  it("honors explicit env values", () => {
    const config = loadPaidGateConfig({
      COMPS_PAID_PROVIDERS_ENABLED: "true",
      COMPS_APIFY_DAILY_BUDGET_CENTS: "1000",
      COMPS_USER_DAILY_PROVIDER_CALL_LIMIT: "5",
    });
    expect(config.paidProvidersEnabled).toBe(true);
    expect(config.dailyBudgetCents).toBe(1000);
    expect(config.userDailyLimit).toBe(5);
  });
});

describe("utc boundaries", () => {
  it("computes UTC day and month starts", () => {
    expect(utcDayStart(now).toISOString()).toBe("2026-06-18T00:00:00.000Z");
    expect(utcMonthStart(now).toISOString()).toBe("2026-06-01T00:00:00.000Z");
  });
});
