import { describe, expect, it } from "vitest";
import { automaticPriceDecision, authorizationMatches, ListingAutomationSchema } from "./policy";

const input = { confidence: 0.98, warnings: [], price: 15000, pricingConfidence: "high", soldCompCount: 10, pricingBasis: "sold_comps", policy: { mode: "publish" as const, marketplace: "ebay" as const, consent: true as const, minPriceCents: 10000, maxPriceCents: 20000 } };

describe("automatic listing authorization", () => {
  it("requires explicit consent and valid finite price bounds", () => {
    expect(ListingAutomationSchema.safeParse({ ...input.policy, consent: false }).success).toBe(false);
    expect(ListingAutomationSchema.safeParse({ ...input.policy, maxPriceCents: 5000 }).success).toBe(false);
    expect(ListingAutomationSchema.safeParse({ ...input.policy, minPriceCents: NaN }).success).toBe(false);
    expect(ListingAutomationSchema.safeParse({ ...input.policy, marketplace: "stockx" }).success).toBe(false);
  });
  it("accepts reliable evidence within the consented range", () => expect(automaticPriceDecision(input)).toBeNull());
  it.each([
    { confidence: 0.65 }, { warnings: ["Size uncertain"] }, { price: 9999 }, { price: 20001 },
    { pricingBasis: "active_market_estimate" }, { pricingConfidence: "medium" }, { soldCompCount: 2 }, { price: null },
  ])("parks an unsafe automatic price: %j", (change) => expect(automaticPriceDecision({ ...input, ...change })).not.toBeNull());
  it("rejects edits and price changes after preparation", () => {
    const date = new Date();
    const item = { updatedAt: date, listingDrafts: [{ updatedAt: date, recommendedPriceCents: 15000 }] };
    const authorization = { itemVersion: date.toISOString(), draftVersion: date.toISOString(), priceCents: 15000 };
    expect(authorizationMatches(authorization, item)).toBe(true);
    expect(authorizationMatches({ ...authorization, priceCents: 25000 }, item)).toBe(false);
    expect(authorizationMatches({ ...authorization, draftVersion: "old" }, item)).toBe(false);
    expect(authorizationMatches(authorization, { listingDrafts: [] })).toBe(false);
  });
});
