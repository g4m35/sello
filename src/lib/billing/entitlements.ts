import "server-only";

import { getPrisma } from "@/lib/prisma";

import { getActiveAccount } from "./account";
import { planFeatureRequired } from "./errors";
import {
  featuresFor,
  limitsFor,
  type FeatureFlag,
  type PlanFeatures,
  type PlanId,
  type PlanLimits,
} from "./plans";

type Db = ReturnType<typeof getPrisma>;

export interface Entitlements {
  plan: PlanId;
  limits: PlanLimits;
  features: PlanFeatures;
}

export function entitlementsForPlan(plan: PlanId): Entitlements {
  return { plan, limits: limitsFor(plan), features: featuresFor(plan) };
}

export async function getEntitlements(
  userId: string,
  prisma: Db = getPrisma(),
): Promise<Entitlements> {
  const account = await getActiveAccount(userId, prisma);
  return entitlementsForPlan(account.plan);
}

// Throws PLAN_FEATURE_REQUIRED unless the plan grants the feature. Boolean flags
// must be true; the tri-state profitTracking must be other than "none".
export function requirePlanFeature(entitlements: Entitlements, feature: FeatureFlag): void {
  const value = entitlements.features[feature];
  const granted = typeof value === "string" ? value !== "none" : Boolean(value);
  if (!granted) throw planFeatureRequired();
}
