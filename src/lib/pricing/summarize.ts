import { calculatePricing, type PricingSummary } from "@/lib/pricing/comps";

// Structural row type — assignable from a Prisma PriceComp findMany result, but
// decoupled from the generated client so this stays a pure utility.
export type PriceCompRow = {
  priceCents: number;
  shippingCents: number;
  totalPriceCents: number | null;
  status: "sold" | "active" | "unknown";
  sourceType?: string | null;
  usedInPricing: boolean;
  ignoredAsOutlier: boolean;
  matchScore: number | null;
  soldDate: Date | null;
  brand: string | null;
  size: string | null;
  condition: string | null;
};

export function summarizeComps(comps: PriceCompRow[]): PricingSummary {
  return calculatePricing(
    comps.map((c) => ({
      priceCents: c.priceCents,
      shippingCents: c.shippingCents,
      totalPriceCents: c.totalPriceCents,
      status: c.status,
      sourceType: c.sourceType,
      usedInPricing: c.usedInPricing,
      ignoredAsOutlier: c.ignoredAsOutlier,
      matchScore: c.matchScore,
      soldDate: c.soldDate,
      brand: c.brand,
      size: c.size,
      condition: c.condition,
    })),
  );
}
