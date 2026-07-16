import type { PlanTier, SubscriptionStatus } from "@/generated/prisma/client";

export type EntitlementReasonCode =
  | "ALLOWED"
  | "ACCOUNT_DISABLED"
  | "GLOBAL_KILL_SWITCH_ACTIVE"
  | "FEATURE_KILL_SWITCH_ACTIVE"
  | "PROVIDER_KILL_SWITCH_ACTIVE"
  | "ENVIRONMENT_CAPABILITY_UNAVAILABLE"
  | "PROVIDER_UNAVAILABLE"
  | "MARKETPLACE_APPROVAL_REQUIRED"
  | "SUBSCRIPTION_INACTIVE"
  | "PLAN_FEATURE_REQUIRED"
  | "ALPHA_OR_BETA_ACCESS_REQUIRED";

export type EntitlementDecision = {
  allowed: boolean;
  reason: EntitlementReasonCode;
  sellerCopy: string;
  effectivePlan: PlanTier;
  gracePeriodActive: boolean;
  adminOverrideApplied: boolean;
};

export type EntitlementDecisionInput = {
  plan: PlanTier;
  now?: Date;
  accountEnabled?: boolean;
  subscriptionRequired?: boolean;
  subscriptionStatus?: SubscriptionStatus | null;
  graceEndsAt?: Date | null;
  adminOverride?: boolean;
  planGranted?: boolean;
  allowlistRequired?: boolean;
  allowlisted?: boolean;
  marketplaceApprovalRequired?: boolean;
  marketplaceApproved?: boolean;
  providerRequired?: boolean;
  providerAvailable?: boolean;
  environmentCapable?: boolean;
  globalEnabled?: boolean;
  featureEnabled?: boolean;
  providerEnabled?: boolean;
};

const COPY: Record<Exclude<EntitlementReasonCode, "ALLOWED">, string> = {
  ACCOUNT_DISABLED:
    "This seller account is temporarily disabled. Contact support before trying again.",
  GLOBAL_KILL_SWITCH_ACTIVE:
    "This action is temporarily unavailable while Sello completes a safety check.",
  FEATURE_KILL_SWITCH_ACTIVE:
    "This feature is temporarily unavailable. Try again later.",
  PROVIDER_KILL_SWITCH_ACTIVE:
    "The required provider is temporarily disabled. Try again later.",
  ENVIRONMENT_CAPABILITY_UNAVAILABLE:
    "This action is not available in the current environment.",
  PROVIDER_UNAVAILABLE:
    "The required provider is not available for this action.",
  MARKETPLACE_APPROVAL_REQUIRED:
    "This marketplace requires approval before Sello can automate this action.",
  SUBSCRIPTION_INACTIVE:
    "Your subscription is not active. Update billing to continue.",
  PLAN_FEATURE_REQUIRED:
    "Upgrade your plan to use this feature.",
  ALPHA_OR_BETA_ACCESS_REQUIRED:
    "This feature is currently available to selected beta accounts.",
};

const ACTIVE_SUBSCRIPTION_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  "active",
  "trialing",
]);

function denied(
  input: EntitlementDecisionInput,
  reason: Exclude<EntitlementReasonCode, "ALLOWED">,
  gracePeriodActive = false,
): EntitlementDecision {
  return {
    allowed: false,
    reason,
    sellerCopy: COPY[reason],
    effectivePlan: input.plan,
    gracePeriodActive,
    adminOverrideApplied: false,
  };
}

/**
 * Authoritative entitlement order. Safety/capability gates always run before
 * admin override, so admin access cannot bypass kill switches, missing provider
 * capability, marketplace approval, environment restrictions, or an explicitly
 * disabled account. Admin override may bypass commercial plan/subscription and
 * alpha/beta allowlist gates for owner testing only.
 */
export function decideEntitlement(input: EntitlementDecisionInput): EntitlementDecision {
  const now = input.now ?? new Date();
  if (input.accountEnabled === false) return denied(input, "ACCOUNT_DISABLED");
  if (input.globalEnabled === false) return denied(input, "GLOBAL_KILL_SWITCH_ACTIVE");
  if (input.featureEnabled === false) return denied(input, "FEATURE_KILL_SWITCH_ACTIVE");
  if (input.providerEnabled === false) return denied(input, "PROVIDER_KILL_SWITCH_ACTIVE");
  if (input.environmentCapable === false) {
    return denied(input, "ENVIRONMENT_CAPABILITY_UNAVAILABLE");
  }
  if (input.providerRequired && input.providerAvailable !== true) {
    return denied(input, "PROVIDER_UNAVAILABLE");
  }
  if (input.marketplaceApprovalRequired && input.marketplaceApproved !== true) {
    return denied(input, "MARKETPLACE_APPROVAL_REQUIRED");
  }

  if (input.adminOverride === true) {
    return {
      allowed: true,
      reason: "ALLOWED",
      sellerCopy: "Access granted.",
      effectivePlan: input.plan,
      gracePeriodActive: false,
      adminOverrideApplied: true,
    };
  }

  const gracePeriodActive = Boolean(
    input.graceEndsAt && input.graceEndsAt.getTime() >= now.getTime(),
  );
  if (
    input.subscriptionRequired &&
    (!input.subscriptionStatus ||
      (!ACTIVE_SUBSCRIPTION_STATUSES.has(input.subscriptionStatus) && !gracePeriodActive))
  ) {
    return denied(input, "SUBSCRIPTION_INACTIVE", gracePeriodActive);
  }
  if (input.planGranted === false) {
    return denied(input, "PLAN_FEATURE_REQUIRED", gracePeriodActive);
  }
  if (input.allowlistRequired && input.allowlisted !== true) {
    return denied(input, "ALPHA_OR_BETA_ACCESS_REQUIRED", gracePeriodActive);
  }

  return {
    allowed: true,
    reason: "ALLOWED",
    sellerCopy: "Access granted.",
    effectivePlan: input.plan,
    gracePeriodActive,
    adminOverrideApplied: false,
  };
}
