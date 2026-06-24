import "server-only";

import { featureAccessForUser } from "@/lib/auth/feature-access";

import { isEtsyApiEnabled } from "./config";
import { EtsyIntegrationError, etsyErrorCodes } from "./errors";

// Per-seller Etsy capability resolution. Fails closed: live capabilities are only
// true when the global ETSY_API_ENABLED switch is on AND the seller is on the
// matching allowlist. Copy-ready is always available as the fallback, so a seller
// who is not (yet) gated for live automation can still export a paste-ready draft.
export type EtsyCapabilities = {
  copy: boolean;
  connect: boolean;
  publish: boolean;
  delist: boolean;
  orders: boolean;
};

export function resolveEtsyCapabilities(
  user: { email?: string | null },
  env: Record<string, string | undefined> = process.env,
): EtsyCapabilities {
  const apiEnabled = isEtsyApiEnabled(env);
  const access = featureAccessForUser(user, env);

  return {
    copy: true,
    connect: apiEnabled && access.etsyConnect,
    publish: apiEnabled && access.etsyPublish,
    delist: apiEnabled && access.etsyDelist,
    orders: apiEnabled && access.etsyOrders,
  };
}

const CAPABILITY_DENIAL_CODE: Record<
  Exclude<keyof EtsyCapabilities, "copy">,
  (typeof etsyErrorCodes)[keyof typeof etsyErrorCodes]
> = {
  connect: etsyErrorCodes.notEnabled,
  publish: etsyErrorCodes.publishNotEnabled,
  delist: etsyErrorCodes.delistNotEnabled,
  orders: etsyErrorCodes.notEnabled,
};

// Fail-closed gate for a live Etsy action. Throws a typed, safe error when the
// global switch is off or the seller is not allowlisted for the capability.
export function requireEtsyCapability(
  user: { email?: string | null },
  capability: Exclude<keyof EtsyCapabilities, "copy">,
  env: Record<string, string | undefined> = process.env,
): void {
  if (!isEtsyApiEnabled(env)) {
    throw new EtsyIntegrationError(
      etsyErrorCodes.notEnabled,
      "Etsy API integration is not enabled. Use the copy-ready draft instead.",
      503,
    );
  }

  if (!resolveEtsyCapabilities(user, env)[capability]) {
    throw new EtsyIntegrationError(
      CAPABILITY_DENIAL_CODE[capability],
      "Etsy live actions are not enabled for your account yet.",
      403,
    );
  }
}
