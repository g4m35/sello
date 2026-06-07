import type { CompQuery, CompSource, NormalizedComp } from "@/lib/comps/source";

// eBay Marketplace Insights API = real SOLD comps (last ~90 days). This is the
// primary source once access is approved (gated, application required). Disabled
// until EBAY_INSIGHTS_TOKEN is configured; never returns invented data.
export const ebayInsightsSource: CompSource = {
  id: "ebay-insights",
  displayName: "eBay (sold)",
  sold: true,
  isEnabled() {
    return Boolean(process.env.EBAY_INSIGHTS_TOKEN);
  },
  async fetchComps(_query: CompQuery): Promise<NormalizedComp[]> {
    void _query;
    // TODO: implement once Marketplace Insights access is granted.
    return [];
  },
};
