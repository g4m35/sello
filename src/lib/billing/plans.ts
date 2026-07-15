// The single source of truth for Sello's billing tiers. This catalog drives
// Stripe price wiring, entitlement gating, usage metering, and the pricing UI.
// Keep it pure (no I/O) so it is trivially testable and importable anywhere.

export type PlanId = "free" | "pro" | "kingpin";

export interface PlanLimits {
  aiListingsPerMonth: number;
  autopublishesPerMonth: number;
  compRefreshesPerMonth: number;
  marketplaceConnections: number;
  bulkBatchSize: number;
  teamSeats: number;
}

export interface PlanFeatures {
  basicAnalytics: boolean;
  profitTracking: "none" | "simple" | "advanced";
  templates: boolean;
  assistedSoldDelist: boolean;
  fullInventorySync: boolean;
  autoDelist: boolean;
  soldDetection: boolean;
  advancedComps: boolean;
  advancedAnalytics: boolean;
  repricing: boolean;
  deadStock: boolean;
  performanceAnalytics: boolean;
  priorityQueue: boolean;
  prioritySupport: boolean;
}

export type FeatureFlag = keyof PlanFeatures;

export interface Plan {
  id: PlanId;
  name: string;
  priceCents: number;
  // Env var holding the Stripe price id for paid plans; null for free.
  stripePriceIdEnv: string | null;
  limits: PlanLimits;
  features: PlanFeatures;
}

const NO_FEATURES: PlanFeatures = {
  basicAnalytics: false,
  profitTracking: "none",
  templates: false,
  assistedSoldDelist: false,
  fullInventorySync: false,
  autoDelist: false,
  soldDetection: false,
  advancedComps: false,
  advancedAnalytics: false,
  repricing: false,
  deadStock: false,
  performanceAnalytics: false,
  priorityQueue: false,
  prioritySupport: false,
};

export const PLAN_CATALOG: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceCents: 0,
    stripePriceIdEnv: null,
    limits: {
      aiListingsPerMonth: 10,
      autopublishesPerMonth: 10,
      compRefreshesPerMonth: 10,
      marketplaceConnections: 1,
      bulkBatchSize: 10,
      teamSeats: 1,
    },
    features: { ...NO_FEATURES },
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceCents: 2000,
    stripePriceIdEnv: "STRIPE_PRICE_PRO",
    limits: {
      aiListingsPerMonth: 125,
      autopublishesPerMonth: 125,
      compRefreshesPerMonth: 100,
      marketplaceConnections: 3,
      bulkBatchSize: 50,
      teamSeats: 1,
    },
    features: {
      ...NO_FEATURES,
      basicAnalytics: true,
      profitTracking: "simple",
      templates: true,
      assistedSoldDelist: true,
    },
  },
  kingpin: {
    id: "kingpin",
    name: "Kingpin",
    priceCents: 11900,
    stripePriceIdEnv: "STRIPE_PRICE_KINGPIN",
    limits: {
      aiListingsPerMonth: 1000,
      autopublishesPerMonth: 1000,
      compRefreshesPerMonth: 750,
      marketplaceConnections: 5,
      bulkBatchSize: 250,
      teamSeats: 5,
    },
    features: {
      basicAnalytics: true,
      profitTracking: "advanced",
      templates: true,
      assistedSoldDelist: true,
      fullInventorySync: true,
      autoDelist: true,
      soldDetection: true,
      advancedComps: true,
      advancedAnalytics: true,
      repricing: true,
      deadStock: true,
      performanceAnalytics: true,
      priorityQueue: true,
      prioritySupport: true,
    },
  },
};

export const PLAN_IDS = Object.keys(PLAN_CATALOG) as PlanId[];
export const PAID_PLAN_IDS: PlanId[] = ["pro", "kingpin"];

export function limitsFor(plan: PlanId): PlanLimits {
  return PLAN_CATALOG[plan].limits;
}

export function featuresFor(plan: PlanId): PlanFeatures {
  return PLAN_CATALOG[plan].features;
}

// Resolve a Stripe price id back to the plan it sells. Returns null for the
// free plan, unknown ids, or unconfigured env (so an empty env never collides
// with an empty incoming id).
export function planForPriceId(
  priceId: string,
  env: Record<string, string | undefined> = process.env,
): PlanId | null {
  if (!priceId) return null;
  for (const plan of PAID_PLAN_IDS) {
    const key = PLAN_CATALOG[plan].stripePriceIdEnv;
    if (key && env[key] && env[key] === priceId) return plan;
  }
  return null;
}
