import { isAdminUser } from "@/lib/auth/admin";

import { featuresFor, limitsFor, type PlanFeatures, type PlanId, type PlanLimits } from "./plans";

type PlanAccount = { plan: PlanId };

// Owner/admin testing is never plan-gated. Numeric limits use a large finite
// ceiling (not Infinity) so JSON/UI meters stay well-behaved.
export const ADMIN_UNLIMITED_LIMIT = 1_000_000_000;

export const ADMIN_UNLIMITED_LIMITS: PlanLimits = {
  aiListingsPerMonth: ADMIN_UNLIMITED_LIMIT,
  autopublishesPerMonth: ADMIN_UNLIMITED_LIMIT,
  compRefreshesPerMonth: ADMIN_UNLIMITED_LIMIT,
  marketplaceConnections: ADMIN_UNLIMITED_LIMIT,
  bulkBatchSize: ADMIN_UNLIMITED_LIMIT,
  teamSeats: ADMIN_UNLIMITED_LIMIT,
};

export function effectivePlanForUser(
  account: PlanAccount,
  user: { id?: string | null; email?: string | null },
  env: Record<string, string | undefined> = process.env,
): PlanId {
  // Admins still surface as kingpin in billing UI (top tier), but quotas use
  // effectiveLimitsForUser which is truly unlimited for admins.
  return isAdminUser(user, env) ? "kingpin" : account.plan;
}

export function accountWithEffectivePlan<T extends PlanAccount>(
  account: T,
  user: { id?: string | null; email?: string | null },
  env: Record<string, string | undefined> = process.env,
): T {
  const plan = effectivePlanForUser(account, user, env);
  return plan === account.plan ? account : { ...account, plan };
}

export function effectiveLimitsForUser(
  account: PlanAccount,
  user: { id?: string | null; email?: string | null },
  env: Record<string, string | undefined> = process.env,
): PlanLimits {
  if (isAdminUser(user, env)) return ADMIN_UNLIMITED_LIMITS;
  return limitsFor(account.plan);
}

export function effectiveFeaturesForUser(
  account: PlanAccount,
  user: { id?: string | null; email?: string | null },
  env: Record<string, string | undefined> = process.env,
): PlanFeatures {
  if (isAdminUser(user, env)) return featuresFor("kingpin");
  return featuresFor(account.plan);
}

export function isUnlimitedAdminUser(
  user: { id?: string | null; email?: string | null },
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isAdminUser(user, env);
}
