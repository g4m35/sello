import { AppError } from "@/lib/errors";

export type UsageMetricKey = "ai_listing" | "autopublish" | "comp_refresh";

const METRIC_LABEL: Record<UsageMetricKey, string> = {
  ai_listing: "AI listings",
  autopublish: "autopublishes",
  comp_refresh: "comp refreshes",
};

// Monthly quota hit. 402 (Payment Required) so the client can distinguish a
// billing wall from an auth or validation failure and surface an upgrade CTA.
export function quotaExceeded(metric: UsageMetricKey): AppError {
  return new AppError(
    `You have used all of your ${METRIC_LABEL[metric]} for this billing period. Upgrade your plan for more.`,
    402,
    `QUOTA_EXCEEDED_${metric.toUpperCase()}`,
  );
}

// The current plan does not include this feature.
export function planFeatureRequired(): AppError {
  return new AppError(
    "This feature is not included in your current plan. Upgrade to unlock it.",
    403,
    "PLAN_FEATURE_REQUIRED",
  );
}

export function connectionLimitReached(limit: number): AppError {
  return new AppError(
    `Your plan allows ${limit} connected marketplace${limit === 1 ? "" : "s"}. Upgrade to connect more.`,
    403,
    "CONNECTION_LIMIT_REACHED",
  );
}

export function bulkBatchTooLarge(limit: number): AppError {
  return new AppError(
    `Your plan allows up to ${limit} items per bulk action. Select fewer items or upgrade your plan.`,
    400,
    "BULK_BATCH_TOO_LARGE",
  );
}
