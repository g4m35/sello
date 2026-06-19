import "server-only";

import { AppError } from "@/lib/errors";

export type FeatureEntitlement =
  | "liveEbayPublish"
  | "ebayDelist"
  | "paidComps";

export type FeatureAccess = Record<FeatureEntitlement, boolean>;

export const FEATURE_ACCESS_COPY = {
  liveEbayPublish:
    "Live eBay publishing is currently enabled for selected alpha accounts.",
  ebayDelist:
    "Live eBay delisting is currently enabled for selected alpha accounts.",
  paidComps:
    "Fresh sold comps are currently enabled for selected alpha accounts.",
} as const;

const FEATURE_ENV_KEYS: Record<FeatureEntitlement, string> = {
  liveEbayPublish: "LIVE_EBAY_PUBLISH_EMAILS",
  ebayDelist: "EBAY_DELIST_EMAILS",
  paidComps: "PAID_COMPS_EMAILS",
};

const FEATURE_DENIAL_CODES: Record<FeatureEntitlement, string> = {
  liveEbayPublish: "LIVE_EBAY_PUBLISH_ALPHA_ONLY",
  ebayDelist: "EBAY_DELIST_ALPHA_ONLY",
  paidComps: "PAID_COMPS_ALPHA_ONLY",
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
  return {
    liveEbayPublish: normalizedEmails(env[FEATURE_ENV_KEYS.liveEbayPublish]),
    ebayDelist: normalizedEmails(env[FEATURE_ENV_KEYS.ebayDelist]),
    paidComps: normalizedEmails(env[FEATURE_ENV_KEYS.paidComps]),
  };
}

export function featureAccessForUser(
  user: { email?: string | null },
  env: Record<string, string | undefined> = process.env,
): FeatureAccess {
  const email = user.email?.trim().toLowerCase();
  if (!email) {
    return {
      liveEbayPublish: false,
      ebayDelist: false,
      paidComps: false,
    };
  }

  const configured = configuredFeatureEmails(env);
  return {
    liveEbayPublish: configured.liveEbayPublish.includes(email),
    ebayDelist: configured.ebayDelist.includes(email),
    paidComps: configured.paidComps.includes(email),
  };
}

export function requireFeatureAccess(
  user: { email?: string | null },
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
