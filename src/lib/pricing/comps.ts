export type PriceCompAmounts = {
  priceCents: number;
  shippingCents: number;
};

export type PricingConfidence = "none" | "low" | "medium" | "high";

export type PricingSummary = {
  status: "needs_comps" | "ready";
  totalComps: number;
  validComps: number;
  lowCents: number | null;
  averageCents: number | null;
  highCents: number | null;
  quickSaleCents: number | null;
  recommendedListCents: number | null;
  confidence: PricingConfidence;
};

// "Slightly below average" for a quick sale and "slightly above average" to
// leave negotiation room. Kept as named constants so the heuristic is explicit.
export const QUICK_SALE_FACTOR = 0.9;
export const LIST_PREMIUM_FACTOR = 1.1;

// When valid comps disagree this much ((high - low) / average), the data set is
// treated as low-similarity and confidence is knocked down one level.
export const WIDE_SPREAD_RATIO = 0.5;

function isValidComp(comp: PriceCompAmounts): boolean {
  return (
    Number.isFinite(comp.priceCents) &&
    comp.priceCents > 0 &&
    Number.isFinite(comp.shippingCents) &&
    comp.shippingCents >= 0
  );
}

function countConfidence(validComps: number): PricingConfidence {
  if (validComps <= 0) return "none";
  if (validComps <= 2) return "low";
  if (validComps <= 4) return "medium";
  return "high";
}

function downgrade(confidence: PricingConfidence): PricingConfidence {
  switch (confidence) {
    case "high":
      return "medium";
    case "medium":
      return "low";
    default:
      return confidence;
  }
}

export function calculatePricing(comps: PriceCompAmounts[]): PricingSummary {
  const totals = comps
    .filter(isValidComp)
    .map((comp) => comp.priceCents + comp.shippingCents);

  if (totals.length === 0) {
    return {
      status: "needs_comps",
      totalComps: comps.length,
      validComps: 0,
      lowCents: null,
      averageCents: null,
      highCents: null,
      quickSaleCents: null,
      recommendedListCents: null,
      confidence: "none",
    };
  }

  const lowCents = Math.min(...totals);
  const highCents = Math.max(...totals);
  const averageCents = Math.round(
    totals.reduce((sum, total) => sum + total, 0) / totals.length,
  );

  let confidence = countConfidence(totals.length);
  const spreadRatio = (highCents - lowCents) / averageCents;
  if (spreadRatio > WIDE_SPREAD_RATIO) {
    confidence = downgrade(confidence);
  }

  return {
    status: "ready",
    totalComps: comps.length,
    validComps: totals.length,
    lowCents,
    averageCents,
    highCents,
    quickSaleCents: Math.round(averageCents * QUICK_SALE_FACTOR),
    recommendedListCents: Math.round(averageCents * LIST_PREMIUM_FACTOR),
    confidence,
  };
}
