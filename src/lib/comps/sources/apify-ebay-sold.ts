import type { CompQuery, CompSource, NormalizedComp } from "@/lib/comps/source";

// Apify eBay sold-listings actor. Sold comps via a third-party scraper service
// (not eBay Marketplace Insights, which is access-restricted). Gated on
// APIFY_TOKEN; returns [] until the actor integration is built.
export const apifyEbaySoldSource: CompSource = {
  id: "apify-ebay-sold",
  displayName: "eBay sold (Apify)",
  sold: true,
  isEnabled() {
    return process.env.PRICE_COMP_APIFY_EBAY_SOLD_ENABLED === "true" && Boolean(process.env.APIFY_TOKEN);
  },
  async fetchComps(_query: CompQuery): Promise<NormalizedComp[]> {
    void _query;
    // TODO: call the Apify eBay-sold actor once the integration is built.
    return [];
  },
};
