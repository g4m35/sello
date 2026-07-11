import {
  compsApifyDailyBudgetCents,
  compsApifyEstimatedCostCents,
  compsDraftProviderCooldownSeconds,
  compsUserDailyProviderCallLimit,
  compsUserMonthlyProviderCallLimit,
  isCompsAdminOverrideEnabled,
  isCompsPaidProvidersEnabled,
} from "@/lib/comps/flags";

// Server-side budget & quota gate for PAID comp providers (e.g. Apify). Pure and
// deterministic: it takes already-loaded config + usage and decides allow/skip
// with a typed reason. All usage counts are computed from the ProviderCallLedger
// (seller-scoped) by the caller; this module never touches the DB or env beyond
// loadPaidGateConfig.

type Env = Record<string, string | undefined>;

export type PaidProviderSkipReason =
  | "paid_providers_disabled"
  | "global_budget_exceeded"
  | "user_daily_quota_exceeded"
  | "user_monthly_quota_exceeded"
  | "draft_cooldown_active"
  | "weak_identity"
  | "provider_not_configured"
  | "duplicate_request"
  | "provider_error";

export type PaidGateConfig = {
  paidProvidersEnabled: boolean;
  adminOverride: boolean;
  dailyBudgetCents: number;
  userDailyLimit: number;
  userMonthlyLimit: number;
  draftCooldownSeconds: number;
  estimatedCostCents: number;
};

export type PaidGateUsage = {
  globalSpentTodayCents: number;
  userCallsToday: number;
  userCallsThisMonth: number;
  lastDraftCallAt: Date | null;
};

export type PaidGateResult =
  | { allowed: true }
  | { allowed: false; reason: PaidProviderSkipReason };

export function loadPaidGateConfig(env: Env = process.env): PaidGateConfig {
  return {
    paidProvidersEnabled: isCompsPaidProvidersEnabled(env),
    adminOverride: isCompsAdminOverrideEnabled(env),
    dailyBudgetCents: compsApifyDailyBudgetCents(env),
    userDailyLimit: compsUserDailyProviderCallLimit(env),
    userMonthlyLimit: compsUserMonthlyProviderCallLimit(env),
    draftCooldownSeconds: compsDraftProviderCooldownSeconds(env),
    estimatedCostCents: compsApifyEstimatedCostCents(env),
  };
}

export function evaluatePaidProviderGate(args: {
  config: PaidGateConfig;
  usage: PaidGateUsage;
  now: Date;
}): PaidGateResult {
  const { config, usage, now } = args;

  // The kill switch is absolute and overrides admin override.
  if (!config.paidProvidersEnabled) {
    return { allowed: false, reason: "paid_providers_disabled" };
  }
  // Admin override bypasses budget/quota/cooldown (but not the kill switch above).
  if (config.adminOverride) {
    return { allowed: true };
  }
  if (usage.globalSpentTodayCents + config.estimatedCostCents > config.dailyBudgetCents) {
    return { allowed: false, reason: "global_budget_exceeded" };
  }
  if (usage.userCallsToday >= config.userDailyLimit) {
    return { allowed: false, reason: "user_daily_quota_exceeded" };
  }
  if (usage.userCallsThisMonth >= config.userMonthlyLimit) {
    return { allowed: false, reason: "user_monthly_quota_exceeded" };
  }
  if (usage.lastDraftCallAt && config.draftCooldownSeconds > 0) {
    const elapsedSeconds = (now.getTime() - usage.lastDraftCallAt.getTime()) / 1000;
    if (elapsedSeconds < config.draftCooldownSeconds) {
      return { allowed: false, reason: "draft_cooldown_active" };
    }
  }
  return { allowed: true };
}

export function utcDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
}

export function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}
