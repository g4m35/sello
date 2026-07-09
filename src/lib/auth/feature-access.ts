import "server-only";

import { isAdminUser } from "@/lib/auth/admin";
import { AppError } from "@/lib/errors";

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

function allEntitlementsGranted(): FeatureAccess {
  return Object.fromEntries(
    FEATURE_ENTITLEMENTS.map((entitlement) => [entitlement, true]),
  ) as FeatureAccess;
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
  if (isAdminUser(user, env)) {
    return allEntitlementsGranted();
  }

  const email = user.email?.trim().toLowerCase();
  const configured = configuredFeatureEmails(env);
  return Object.fromEntries(
    FEATURE_ENTITLEMENTS.map((entitlement) => [
      entitlement,
      email ? configured[entitlement].includes(email) : false,
    ]),
  ) as FeatureAccess;
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
