import type { CompQuery, NormalizedComp, SoldCompSource } from "@/lib/comps/source";

// eBay Marketplace Insights is the official eBay sold-history API, but eBay
// marks it as limited/restricted access. Keep this adapter explicit so sold
// comps can be wired safely once access is approved, without scraping completed
// listings or mislabeling active Browse results as sales.
export const ebayMarketplaceInsightsSource: SoldCompSource = {
  id: "ebay-marketplace-insights",
  displayName: "eBay Marketplace Insights (sold comps)",
  sold: true,
  resultKind: "sold_comps",
  isEnabled() {
    return (
      process.env.PRICE_COMP_EBAY_MARKETPLACE_INSIGHTS_ENABLED === "true" &&
      process.env.EBAY_MARKETPLACE_INSIGHTS_ACCESS_APPROVED === "true" &&
      Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET)
    );
  },
  async fetchComps(_query: CompQuery): Promise<NormalizedComp[]> {
    void _query;
    // TODO: implement only after eBay approves Marketplace Insights access.
    return [];
  },
};
