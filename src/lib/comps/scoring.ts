import type { NormalizedComp } from "@/lib/comps/source";

export type ScoreItemInput = {
  productName: string;
  brand: string | null;
  styleCode: string | null;
  size: string | null;
  category: string;
  colorway?: string | null;
  condition?: string | null;
};

export type MatchClassification = "strong" | "possible" | "weak" | "rejected";

export type MatchScore = {
  score: number;
  classification: MatchClassification;
  reasons: string[];
};

const STOP_WORDS = new Set([
  "the",
  "and",
  "with",
  "men",
  "mens",
  "women",
  "womens",
  "size",
  "jacket",
  "shoe",
  "shoes",
  "sneaker",
  "sneakers",
]);

function norm(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value: string | null | undefined): Set<string> {
  return new Set(
    norm(value)
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
  );
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let count = 0;
  for (const token of a) {
    if (b.has(token)) count += 1;
  }
  return count / Math.max(a.size, b.size);
}

function includesNorm(haystack: string | null | undefined, needle: string | null | undefined) {
  const h = norm(haystack);
  const n = norm(needle);
  return Boolean(h && n && h.includes(n));
}

function classify(score: number): MatchClassification {
  if (score >= 0.72) return "strong";
  if (score >= 0.45) return "possible";
  if (score >= 0.3) return "weak";
  return "rejected";
}

export function scoreCompMatch(item: ScoreItemInput, comp: NormalizedComp): MatchScore {
  let score = 0;
  const reasons: string[] = [];

  if (item.brand && comp.brand && norm(item.brand) === norm(comp.brand)) {
    score += 0.28;
    reasons.push("Brand matches.");
  } else if (item.brand && includesNorm(comp.title, item.brand)) {
    score += 0.22;
    reasons.push("Brand appears in title.");
  } else if (item.brand || comp.brand) {
    score -= 0.18;
    reasons.push("Brand differs.");
  }

  if (item.styleCode && includesNorm(comp.title, item.styleCode)) {
    score += 0.25;
    reasons.push("Style code appears in title.");
  }

  const titleOverlap = overlap(tokens(item.productName), tokens(comp.title));
  if (titleOverlap >= 0.65) {
    score += 0.28;
    reasons.push("Strong title token match.");
  } else if (titleOverlap >= 0.35) {
    score += 0.18;
    reasons.push("Some title tokens match.");
  } else if (titleOverlap > 0) {
    score += 0.08;
    reasons.push("Weak title token overlap.");
  }

  if (item.colorway && includesNorm(comp.title, item.colorway)) {
    score += 0.08;
    reasons.push("Colorway appears in title.");
  }

  if (item.size && comp.size && norm(item.size) === norm(comp.size)) {
    score += 0.08;
    reasons.push("Size matches.");
  } else if (item.size && includesNorm(comp.title, item.size)) {
    score += 0.06;
    reasons.push("Size appears in title.");
  }

  if (item.condition && comp.condition && comp.condition !== "unknown") {
    if (norm(item.condition) === norm(comp.condition)) {
      score += 0.04;
      reasons.push("Condition matches.");
    } else {
      score += 0.02;
      reasons.push("Condition is comparable but not exact.");
    }
  }

  if (item.category && comp.category && norm(item.category) === norm(comp.category)) {
    score += 0.04;
    reasons.push("Category matches.");
  }

  if (comp.sold) {
    score += 0.04;
    reasons.push("Sold comp.");
  }

  score = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  return { score, classification: classify(score), reasons };
}
