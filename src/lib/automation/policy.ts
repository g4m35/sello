import { z } from "zod";

// Per-upload consent. Existing listings never acquire permission implicitly.
export const ListingAutomationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("prepare") }).strict(),
  z.object({
    mode: z.literal("publish"),
    marketplace: z.literal("ebay"),
    consent: z.literal(true),
    minPriceCents: z.number().int().positive(),
    maxPriceCents: z.number().int().positive().max(10_000_000),
  }).strict(),
]).refine((p) => p.mode === "prepare" || p.minPriceCents <= p.maxPriceCents, "Minimum price must not exceed maximum price.");

export type ListingAutomation = z.infer<typeof ListingAutomationSchema>;
export type PublishAuthorization = { itemVersion: string; draftVersion: string; priceCents: number };

export function automaticPriceDecision(input: {
  confidence: number | null;
  warnings: string[];
  price: number | null;
  pricingConfidence: string;
  soldCompCount: number;
  pricingBasis: string;
  policy: ListingAutomation;
}): string | null {
  if (input.confidence == null || input.confidence < 0.9 || input.warnings.length) return "Confirm the identified item and its details.";
  if (input.pricingConfidence !== "high" || input.pricingBasis !== "sold_comps" || input.soldCompCount < 3 || !input.price || !Number.isSafeInteger(input.price)) return "Reliable sold comparisons are needed before choosing a price automatically.";
  if (input.policy.mode === "publish" && (input.price < input.policy.minPriceCents || input.price > input.policy.maxPriceCents)) return "The suggested price is outside your authorized range.";
  return null;
}

export function authorizationMatches(
  authorization: PublishAuthorization,
  item: { updatedAt?: Date; listingDrafts: { updatedAt?: Date; recommendedPriceCents: number | null }[] },
) {
  const draft = item.listingDrafts[0];
  return item.updatedAt?.toISOString() === authorization.itemVersion &&
    draft?.updatedAt?.toISOString() === authorization.draftVersion &&
    draft?.recommendedPriceCents === authorization.priceCents;
}

export function hasSingleEbayQuantity(marketplaceDrafts: unknown): boolean {
  const parsed = z.object({ ebay: z.object({ quantity: z.number().int().optional() }).passthrough().optional() }).passthrough().safeParse(marketplaceDrafts ?? {});
  return parsed.success && (parsed.data.ebay?.quantity ?? 1) === 1;
}
