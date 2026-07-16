import "server-only";

import { isAdminUser } from "@/lib/auth/admin";
import {
  decideEntitlement,
  type EntitlementDecision,
} from "@/lib/auth/entitlement-decision";
import { getActiveAccount, type AccountRecord } from "@/lib/billing/account";
import {
  effectiveFeaturesForUser,
  effectiveLimitsForUser,
  effectivePlanForUser,
} from "@/lib/billing/effective-plan";
import type { PlanFeatures, PlanLimits } from "@/lib/billing/plans";
import { isApifyEbaySoldEnabled, isCompsPaidProvidersEnabled } from "@/lib/comps/flags";
import { AppError } from "@/lib/errors";
import { getEbayConfig, isEbayProductionPublishEnabled } from "@/lib/marketplace/adapters/ebay/config";
import { isEtsyApiEnabled } from "@/lib/marketplace/adapters/etsy/config";
import { getPrisma } from "@/lib/prisma";

type Db = ReturnType<typeof getPrisma>;

export type FeatureEntitlement =
  | "liveEbayPublish"
  | "ebayDelist"
  | "paidComps"
  | "etsyConnect"
  | "etsyPublish"
  | "etsyDelist"
  | "etsyOrders";

export type FeatureAccess = Record<FeatureEntitlement, boolean>;

export const FEATURE_ACCESS_COPY = {
  liveEbayPublish:
    "Live eBay publishing is currently enabled for selected alpha accounts.",
  ebayDelist:
    "Live eBay delisting is currently enabled for selected alpha accounts.",
  paidComps:
    "Fresh sold comps are currently enabled for selected alpha accounts.",
  etsyConnect:
    "Connecting an Etsy shop is currently enabled for selected alpha accounts.",
  etsyPublish:
    "Live Etsy publishing is currently enabled for selected alpha accounts.",
  etsyDelist:
    "Live Etsy delisting is currently enabled for selected alpha accounts.",
  etsyOrders:
    "Etsy order sync is currently enabled for selected alpha accounts.",
} as const;

const FEATURE_ENV_KEYS: Record<FeatureEntitlement, string> = {
  liveEbayPublish: "LIVE_EBAY_PUBLISH_EMAILS",
  ebayDelist: "EBAY_DELIST_EMAILS",
  paidComps: "PAID_COMPS_EMAILS",
  etsyConnect: "ETSY_CONNECT_EMAILS",
  etsyPublish: "ETSY_PUBLISH_EMAILS",
  etsyDelist: "ETSY_DELIST_EMAILS",
  etsyOrders: "ETSY_ORDERS_EMAILS",
};

const FEATURE_DENIAL_CODES: Record<FeatureEntitlement, string> = {
  liveEbayPublish: "LIVE_EBAY_PUBLISH_ALPHA_ONLY",
  ebayDelist: "EBAY_DELIST_ALPHA_ONLY",
  paidComps: "PAID_COMPS_ALPHA_ONLY",
  etsyConnect: "ETSY_CONNECT_ALPHA_ONLY",
  etsyPublish: "ETSY_PUBLISH_ALPHA_ONLY",
  etsyDelist: "ETSY_DELIST_ALPHA_ONLY",
  etsyOrders: "ETSY_ORDERS_ALPHA_ONLY",
};

const FEATURE_ENTITLEMENTS = Object.keys(FEATURE_ENV_KEYS) as FeatureEntitlement[];
const COMMERCIAL_SAFETY_ENTITLEMENTS = new Set<FeatureEntitlement>([
  "ebayDelist",
  "etsyDelist",
  "etsyOrders",
]);

export type RuntimeEntitlements = {
  account: AccountRecord;
  access: FeatureAccess;
  decisions: Record<FeatureEntitlement, EntitlementDecision>;
  plan: AccountRecord["plan"];
  limits: PlanLimits;
  features: PlanFeatures;
};

function normalizedEmails(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? "")
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export function configuredFeatureEmails(
  env: Record<string, string | undefined> = process.env,
): Record<FeatureEntitlement, string[]> {
  return Object.fromEntries(
    FEATURE_ENTITLEMENTS.map((entitlement) => [
      entitlement,
      normalizedEmails(env[FEATURE_ENV_KEYS[entitlement]]),
    ]),
  ) as Record<FeatureEntitlement, string[]>;
}

// Admins get every entitlement so owner testing is not blocked by separate
// alpha allowlists. Global kill-switches (e.g. COMPS_PAID_PROVIDERS_ENABLED,
// EBAY_PRODUCTION_PUBLISH_ENABLED) still apply.
export function featureAccessForUser(
  user: { id?: string | null; email?: string | null },
  env: Record<string, string | undefined> = process.env,
): FeatureAccess {
  const adminOverride = isAdminUser(user, env);
  const email = user.email?.trim().toLowerCase();
  const configured = configuredFeatureEmails(env);
  return Object.fromEntries(
    FEATURE_ENTITLEMENTS.map((entitlement) => [
      entitlement,
      decideEntitlement({
        plan: "free",
        adminOverride,
        accountEnabled: true,
        subscriptionRequired: false,
        planGranted: true,
        allowlistRequired: true,
        allowlisted: email ? configured[entitlement].includes(email) : false,
        globalEnabled: true,
        featureEnabled: true,
        providerEnabled: true,
        environmentCapable: true,
      }).allowed,
    ]),
  ) as FeatureAccess;
}

function ebayProviderAvailable(env: Record<string, string | undefined>): boolean {
  try {
    getEbayConfig(env);
    return true;
  } catch {
    return false;
  }
}

function runtimeSafetyGates(
  entitlement: FeatureEntitlement,
  env: Record<string, string | undefined>,
): Pick<
  Parameters<typeof decideEntitlement>[0],
  "featureEnabled" | "providerRequired" | "providerAvailable" | "environmentCapable"
> {
  if (entitlement === "paidComps") {
    return {
      featureEnabled: isCompsPaidProvidersEnabled(env),
      providerRequired: true,
      providerAvailable: isApifyEbaySoldEnabled(env),
      environmentCapable: true,
    };
  }
  if (entitlement.startsWith("etsy")) {
    const enabled = isEtsyApiEnabled(env);
    return {
      featureEnabled: enabled,
      providerRequired: true,
      providerAvailable: enabled,
      environmentCapable: true,
    };
  }
  if (entitlement === "liveEbayPublish") {
    return {
      featureEnabled: isEbayProductionPublishEnabled(env),
      providerRequired: true,
      providerAvailable: ebayProviderAvailable(env),
      environmentCapable: env.EBAY_ENV === "production",
    };
  }
  return {
    featureEnabled: true,
    providerRequired: true,
    providerAvailable: ebayProviderAvailable(env),
    environmentCapable: true,
  };
}

/**
 * The server-side source of truth for account, billing, plan, allowlist, and
 * runtime capability decisions. UI capability responses and action routes use
 * this same resolver, so explanatory state cannot drift from enforcement.
 */
export async function resolveRuntimeEntitlements(
  user: { id: string; email?: string | null },
  prisma: Db = getPrisma(),
  env: Record<string, string | undefined> = process.env,
  now = new Date(),
): Promise<RuntimeEntitlements> {
  const account = await getActiveAccount(user.id, prisma);
  const subscription = await prisma.subscription.findUnique({
    where: { accountId: account.id },
    select: { status: true, graceEndsAt: true },
  });
  const configured = configuredFeatureEmails(env);
  const email = user.email?.trim().toLowerCase();
  const adminOverride = isAdminUser(user, env);
  const decisions = Object.fromEntries(
    FEATURE_ENTITLEMENTS.map((entitlement) => {
      const gates = runtimeSafetyGates(entitlement, env);
      const decision = decideEntitlement({
        plan: account.plan,
        now,
        accountEnabled: true,
        // A billing problem must not trap inventory on a marketplace or stop
        // sold-order reconciliation. Creation and paid-provider features still
        // fail closed outside the bounded grace window.
        subscriptionRequired:
          account.plan !== "free" && !COMMERCIAL_SAFETY_ENTITLEMENTS.has(entitlement),
        subscriptionStatus: subscription?.status ?? null,
        graceEndsAt: subscription?.graceEndsAt ?? null,
        adminOverride,
        planGranted: true,
        allowlistRequired: true,
        allowlisted: email ? configured[entitlement].includes(email) : false,
        globalEnabled: true,
        providerEnabled: true,
        ...gates,
      });
      return [entitlement, decision];
    }),
  ) as Record<FeatureEntitlement, EntitlementDecision>;
  const planOptions = { subscription, now };
  return {
    account,
    decisions,
    access: Object.fromEntries(
      FEATURE_ENTITLEMENTS.map((entitlement) => [entitlement, decisions[entitlement].allowed]),
    ) as FeatureAccess,
    plan: effectivePlanForUser(account, user, env, planOptions),
    limits: effectiveLimitsForUser(account, user, env, planOptions),
    features: effectiveFeaturesForUser(account, user, env, planOptions),
  };
}

export async function requireRuntimeFeatureAccess(
  user: { id: string; email?: string | null },
  entitlement: FeatureEntitlement,
  prisma: Db = getPrisma(),
  env: Record<string, string | undefined> = process.env,
): Promise<RuntimeEntitlements> {
  const resolved = await resolveRuntimeEntitlements(user, prisma, env);
  const decision = resolved.decisions[entitlement];
  if (decision.allowed) return resolved;
  // Preserve feature-specific alpha denial codes/copy at the API boundary while
  // keeping the shared decision reason available on resolved.decisions.
  if (decision.reason === "ALPHA_OR_BETA_ACCESS_REQUIRED") {
    throw new AppError(
      FEATURE_ACCESS_COPY[entitlement],
      403,
      FEATURE_DENIAL_CODES[entitlement],
    );
  }
  throw new AppError(decision.sellerCopy, 403, decision.reason);
}

export function requireFeatureAccess(
  user: { id?: string | null; email?: string | null },
  entitlement: FeatureEntitlement,
  env: Record<string, string | undefined> = process.env,
): void {
  if (featureAccessForUser(user, env)[entitlement]) {
    return;
  }

  throw new AppError(
    FEATURE_ACCESS_COPY[entitlement],
    403,
    FEATURE_DENIAL_CODES[entitlement],
  );
}
