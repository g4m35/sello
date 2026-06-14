export type CompStatus = "sold" | "active" | "unknown";
export type PricingBasis = "sold_comps" | "mixed_comps" | "active_market_estimate" | "unknown";

// Richer per-comp input. Every field beyond price/shipping is optional so legacy
// callers passing `{ priceCents, shippingCents }` keep working unchanged.
export type PricingComp = {
  priceCents: number;
  shippingCents: number;
  totalPriceCents?: number | null;
  status?: CompStatus;
  sourceType?: string | null;
  usedInPricing?: boolean;
  ignoredAsOutlier?: boolean;
  matchScore?: number | null;
  soldDate?: Date | string | null;
  brand?: string | null;
  size?: string | null;
  condition?: string | null;
};

export type PricingConfidence = "none" | "low" | "medium" | "high";

export type PricingSummary = {
  status: "needs_comps" | "ready";
  totalComps: number;
  validComps: number;
  compCount: number;
  soldCompCount: number;
  activeCompCount: number;
  unknownCompCount: number;
  strongCompCount: number;
  possibleCompCount: number;
  pricingBasis: PricingBasis;
  confidenceCapReason: string | null;
  lowCents: number | null;
  medianCents: number | null;
  averageCents: number | null;
  highCents: number | null;
  quickSaleCents: number | null;
  recommendedListCents: number | null;
  confidence: PricingConfidence;
  confidenceScore: number;
  confidenceReasons: string[];
};

// Median anchors both derived prices: quick sale slightly below, list slightly
// above, to leave negotiation room.
export const QUICK_SALE_FACTOR = 0.9;
export const LIST_PREMIUM_FACTOR = 1.1;
// (high - low) / median above this marks a low-similarity set.
export const WIDE_SPREAD_RATIO = 0.5;
// Sold comps anchor the price only once there are enough to avoid one-off noise.
export const MIN_SOLD_FOR_PREFERENCE = 3;

function isEligible(c: PricingComp): boolean {
  return (
    c.usedInPricing !== false &&
    c.ignoredAsOutlier !== true &&
    Number.isFinite(c.priceCents) &&
    c.priceCents > 0 &&
    Number.isFinite(c.shippingCents) &&
    c.shippingCents >= 0
  );
}

function totalCents(c: PricingComp): number {
  if (c.totalPriceCents != null && Number.isFinite(c.totalPriceCents) && c.totalPriceCents > 0) {
    return c.totalPriceCents;
  }
  return c.priceCents + (Number.isFinite(c.shippingCents) ? c.shippingCents : 0);
}

function median(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1
    ? sortedAsc[mid]
    : Math.round((sortedAsc[mid - 1] + sortedAsc[mid]) / 2);
}

function allShare(set: PricingComp[], get: (c: PricingComp) => string | null | undefined): boolean {
  const values = set.map((c) => (get(c) ?? "").toString().trim().toLowerCase());
  return values.length > 0 && values.every((v) => v !== "" && v === values[0]);
}

function isManualSoldComp(c: PricingComp): boolean {
  return c.sourceType === "manual" && c.status === "sold";
}

function matchBucketCount(set: PricingComp[], min: number, max = 1): number {
  return set.filter((c) => {
    if (typeof c.matchScore !== "number" || !Number.isFinite(c.matchScore)) return false;
    return c.matchScore >= min && c.matchScore <= max;
  }).length;
}

function possibleManualSoldCount(set: PricingComp[]): number {
  return set.filter(
    (c) => isManualSoldComp(c) && (c.matchScore == null || !Number.isFinite(c.matchScore)),
  ).length;
}

function scoreConfidence(args: {
  set: PricingComp[];
  usingSold: boolean;
  soldCompCount: number;
  activeCompCount: number;
  strongCompCount: number;
  possibleCompCount: number;
  lowCents: number;
  highCents: number;
  medianCents: number;
}): { score: number; confidence: PricingConfidence; reasons: string[]; capReason: string | null } {
  const {
    set,
    usingSold,
    soldCompCount,
    activeCompCount,
    strongCompCount,
    possibleCompCount,
    lowCents,
    highCents,
    medianCents,
  } = args;
  const reasons: string[] = [];
  let score = 0;

  const n = set.length;
  if (n >= 5) {
    score += 0.5;
    reasons.push(`${n} comps in the sample.`);
  } else if (n >= 3) {
    score += 0.35;
    reasons.push(`${n} comps in the sample.`);
  } else {
    score += 0.2;
    reasons.push(`Only ${n} comp${n === 1 ? "" : "s"} in the sample.`);
  }

  if (usingSold) {
    score += 0.2;
    reasons.push(`Anchored on ${soldCompCount} sold comp${soldCompCount === 1 ? "" : "s"}.`);
  } else if (soldCompCount > 0) {
    score += 0.08;
    reasons.push(
      `Includes ${soldCompCount} sold comp${soldCompCount === 1 ? "" : "s"}, but fewer than ${MIN_SOLD_FOR_PREFERENCE}; blending with market listings.`,
    );
  } else {
    reasons.push("Active market listings only (asking prices, not sold prices).");
  }

  if (strongCompCount >= 3) {
    score += 0.1;
    reasons.push(`${strongCompCount} strong comp${strongCompCount === 1 ? "" : "s"} matched.`);
  } else if (strongCompCount + possibleCompCount >= 3) {
    score += 0.05;
    reasons.push(`${strongCompCount + possibleCompCount} strong/possible comps matched.`);
  } else {
    reasons.push("Fewer than 3 strong/possible comps.");
  }

  const scored = set.filter(
    (c) => typeof c.matchScore === "number" && Number.isFinite(c.matchScore),
  );
  if (scored.length > 0) {
    const avg = scored.reduce((sum, c) => sum + (c.matchScore as number), 0) / scored.length;
    if (avg >= 0.8) {
      score += 0.15;
      reasons.push("Strong title/style match across comps.");
    } else if (avg >= 0.5) {
      score += 0.07;
      reasons.push("Moderate comp match.");
    } else {
      reasons.push("Weak comp match; treat the range loosely.");
    }
  }

  const now = new Date();
  const ages = set
    .map((c) =>
      c.soldDate ? (now.getTime() - new Date(c.soldDate).getTime()) / 86_400_000 : null,
    )
    .filter((d): d is number => d != null && Number.isFinite(d) && d >= 0);
  if (ages.length > 0) {
    const freshest = Math.min(...ages);
    if (freshest <= 30) {
      score += 0.1;
      reasons.push("Includes sales from the last 30 days.");
    } else if (freshest <= 90) {
      score += 0.05;
      reasons.push("Most recent sale within 90 days.");
    } else {
      reasons.push("Comps are older than 90 days.");
    }
  }

  if (allShare(set, (c) => c.brand)) {
    score += 0.05;
    reasons.push("Consistent brand across comps.");
  }
  if (allShare(set, (c) => c.size)) {
    score += 0.05;
    reasons.push("Consistent size across comps.");
  }
  if (allShare(set, (c) => c.condition)) {
    score += 0.05;
    reasons.push("Consistent condition across comps.");
  }

  const spread = medianCents > 0 ? (highCents - lowCents) / medianCents : 0;
  if (spread > WIDE_SPREAD_RATIO) {
    score -= 0.15;
    reasons.push("Wide price spread lowers confidence.");
  }

  score = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  let capReason: string | null = null;
  if (soldCompCount === 0 && activeCompCount > 0) {
    if (score > 0.64) score = 0.64;
    capReason = "Confidence capped at medium because pricing is based on active market listings, not sold comps.";
    reasons.push(capReason);
  }
  if (soldCompCount > 0 && soldCompCount < MIN_SOLD_FOR_PREFERENCE && activeCompCount > 0) {
    if (score > 0.64) score = 0.64;
    capReason =
      "Confidence capped at medium because fewer than 3 sold comps matched; blending with active market listings.";
    reasons.push(capReason);
  }
  if (strongCompCount + possibleCompCount < 3 && score > 0.44) {
    score = 0.44;
    capReason = "Confidence capped below medium because fewer than 3 strong/possible comps matched.";
    reasons.push(capReason);
  }
  const confidence: PricingConfidence =
    score >= 0.7 ? "high" : score >= 0.45 ? "medium" : "low";
  return { score, confidence, reasons, capReason };
}

export function calculatePricing(comps: PricingComp[]): PricingSummary {
  const eligible = comps.filter(isEligible);
  const soldCompCount = eligible.filter((c) => c.status === "sold").length;
  const activeCompCount = eligible.filter((c) => c.status === "active").length;
  const unknownCompCount = eligible.filter((c) => c.status == null || c.status === "unknown").length;
  const strongCompCount = matchBucketCount(eligible, 0.72);
  const possibleCompCount =
    matchBucketCount(eligible, 0.45, 0.719999) + possibleManualSoldCount(eligible);

  if (eligible.length === 0) {
    return {
      status: "needs_comps",
      totalComps: comps.length,
      validComps: 0,
      compCount: 0,
      soldCompCount: 0,
      activeCompCount: 0,
      unknownCompCount: 0,
      strongCompCount: 0,
      possibleCompCount: 0,
      pricingBasis: "unknown",
      confidenceCapReason: null,
      lowCents: null,
      medianCents: null,
      averageCents: null,
      highCents: null,
      quickSaleCents: null,
      recommendedListCents: null,
      confidence: "none",
      confidenceScore: 0,
      confidenceReasons: ["No comps yet. Add real sold comps or active market listings."],
    };
  }

  const soldEligible = eligible.filter((c) => c.status === "sold");
  const usingSold = soldEligible.length >= MIN_SOLD_FOR_PREFERENCE;
  const anchorSet = usingSold ? soldEligible : eligible;
  const pricingBasis: PricingBasis = usingSold
    ? "sold_comps"
    : soldCompCount > 0 && activeCompCount > 0
      ? "mixed_comps"
      : activeCompCount > 0 && soldCompCount === 0
        ? "active_market_estimate"
        : "unknown";

  const totals = anchorSet.map(totalCents).sort((a, b) => a - b);
  const lowCents = totals[0];
  const highCents = totals[totals.length - 1];
  const medianCents = median(totals);
  const averageCents = Math.round(totals.reduce((sum, t) => sum + t, 0) / totals.length);

  const { score, confidence, reasons, capReason } = scoreConfidence({
    set: anchorSet,
    usingSold,
    soldCompCount,
    activeCompCount,
    strongCompCount,
    possibleCompCount,
    lowCents,
    highCents,
    medianCents,
  });

  return {
    status: "ready",
    totalComps: comps.length,
    validComps: eligible.length,
    compCount: eligible.length,
    soldCompCount,
    activeCompCount,
    unknownCompCount,
    strongCompCount,
    possibleCompCount,
    pricingBasis,
    confidenceCapReason: capReason,
    lowCents,
    medianCents,
    averageCents,
    highCents,
    quickSaleCents: Math.round(medianCents * QUICK_SALE_FACTOR),
    recommendedListCents: Math.round(medianCents * LIST_PREMIUM_FACTOR),
    confidence,
    confidenceScore: score,
    confidenceReasons: reasons,
  };
}
