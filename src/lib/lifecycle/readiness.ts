export const READINESS_THRESHOLDS = {
  titleMinLength: 10,
  descriptionMinLength: 20,
  minBulletPoints: 3,
  minMarketplaces: 1,
} as const;

export const PLACEHOLDER_PRODUCT_NAME = "Awaiting Gemini identification";

export type ReadinessIssueCode =
  | "unidentified_product"
  | "title_too_short"
  | "description_too_short"
  | "insufficient_bullets"
  | "no_marketplace"
  | "missing_price";

export type ReadinessIssue = {
  code: ReadinessIssueCode;
  message: string;
};

export type ReadinessInput = {
  productName: string | null | undefined;
  title: string;
  description: string;
  bulletPoints: string[];
  selectedMarketplaces: string[];
  recommendedPriceCents: number | null | undefined;
};

export type ReadinessResult = {
  ready: boolean;
  issues: ReadinessIssue[];
};

export function countMeaningfulBullets(bulletPoints: string[]): number {
  return bulletPoints.filter((point) => point.trim().length > 0).length;
}

// Single source of truth for "is this item ready to be approved / published".
// Issues are returned in a stable order so the first one is deterministic for
// the UI. Nothing here is silently dropped: every failed rule is reported.
export function evaluateReadiness(input: ReadinessInput): ReadinessResult {
  const issues: ReadinessIssue[] = [];
  const productName = input.productName?.trim() ?? "";

  if (!productName || productName === PLACEHOLDER_PRODUCT_NAME) {
    issues.push({
      code: "unidentified_product",
      message: "Wait for Gemini identification or set a real product name.",
    });
  }

  if (input.title.trim().length < READINESS_THRESHOLDS.titleMinLength) {
    issues.push({
      code: "title_too_short",
      message: `Title needs at least ${READINESS_THRESHOLDS.titleMinLength} characters.`,
    });
  }

  if (
    input.description.trim().length < READINESS_THRESHOLDS.descriptionMinLength
  ) {
    issues.push({
      code: "description_too_short",
      message: `Description needs at least ${READINESS_THRESHOLDS.descriptionMinLength} characters.`,
    });
  }

  if (countMeaningfulBullets(input.bulletPoints) < READINESS_THRESHOLDS.minBulletPoints) {
    issues.push({
      code: "insufficient_bullets",
      message: `Add at least ${READINESS_THRESHOLDS.minBulletPoints} bullet points.`,
    });
  }

  if (input.selectedMarketplaces.length < READINESS_THRESHOLDS.minMarketplaces) {
    issues.push({
      code: "no_marketplace",
      message: "Select at least one marketplace.",
    });
  }

  if (
    input.recommendedPriceCents == null ||
    !Number.isFinite(input.recommendedPriceCents) ||
    input.recommendedPriceCents <= 0
  ) {
    issues.push({
      code: "missing_price",
      message: "Set a seller price above $0 before the item is ready.",
    });
  }

  return { ready: issues.length === 0, issues };
}
