import { isAdminUser } from "@/lib/auth/admin";

import { featuresFor, limitsFor, type PlanFeatures, type PlanId, type PlanLimits } from "./plans";

type PlanAccount = { plan: PlanId };
type SubscriptionSnapshot = {
  status:
    | "active"
    | "trialing"
    | "past_due"
    | "canceled"
    | "incomplete"
    | "incomplete_expired"
    | "unpaid"
    | null;
  graceEndsAt: Date | null;
};
type EffectivePlanOptions = {
  subscription: SubscriptionSnapshot | null;
  now?: Date;
};

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

export function hasCommercialPlanAccess(
  account: PlanAccount,
  subscription: SubscriptionSnapshot | null,
  now = new Date(),
): boolean {
  if (account.plan === "free") return true;
  if (subscription?.status === "active" || subscription?.status === "trialing") return true;
  return (
    subscription?.status === "past_due" &&
    subscription.graceEndsAt !== null &&
    subscription.graceEndsAt.getTime() >= now.getTime()
  );
}

export function effectivePlanForUser(
  account: PlanAccount,
  user: { id?: string | null; email?: string | null },
  env: Record<string, string | undefined> = process.env,
  options?: EffectivePlanOptions,
): PlanId {
  // Admins still surface as kingpin in billing UI (top tier), but quotas use
  // effectiveLimitsForUser which is truly unlimited for admins.
  if (isAdminUser(user, env)) return "kingpin";
  if (options && !hasCommercialPlanAccess(account, options.subscription, options.now)) {
    return "free";
  }
  return account.plan;
}

export function accountWithEffectivePlan<T extends PlanAccount>(
  account: T,
  user: { id?: string | null; email?: string | null },
  env: Record<string, string | undefined> = process.env,
  options?: EffectivePlanOptions,
): T {
  const plan = effectivePlanForUser(account, user, env, options);
  return plan === account.plan ? account : { ...account, plan };
}

export function effectiveLimitsForUser(
  account: PlanAccount,
  user: { id?: string | null; email?: string | null },
  env: Record<string, string | undefined> = process.env,
  options?: EffectivePlanOptions,
): PlanLimits {
  if (isAdminUser(user, env)) return ADMIN_UNLIMITED_LIMITS;
  return limitsFor(effectivePlanForUser(account, user, env, options));
}

export function effectiveFeaturesForUser(
  account: PlanAccount,
  user: { id?: string | null; email?: string | null },
  env: Record<string, string | undefined> = process.env,
  options?: EffectivePlanOptions,
): PlanFeatures {
  if (isAdminUser(user, env)) return featuresFor("kingpin");
  return featuresFor(effectivePlanForUser(account, user, env, options));
}

export function isUnlimitedAdminUser(
  user: { id?: string | null; email?: string | null },
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isAdminUser(user, env);
}
