import { isSerpapiEbayActiveEnabled } from "@/lib/comps/flags";
import type { CompQuery, CompSource, NormalizedComp } from "@/lib/comps/source";

// Optional fallback: eBay active listings via SerpApi. Intentionally a dormant
// stub — gated on COMPS_SERPAPI_EBAY_ACTIVE_ENABLED + SERPAPI_API_KEY and returns
// [] until the integration is built. eBay Browse (ebay-browse) is the primary
// active-market source; this exists only as an opt-in backup.
export const serpapiEbayActiveSource: CompSource = {
  id: "serpapi-ebay-active",
  displayName: "eBay active (SerpApi)",
  sold: false,
  resultKind: "active_listings",
  isEnabled() {
    return isSerpapiEbayActiveEnabled();
  },
  async fetchComps(_query: CompQuery): Promise<NormalizedComp[]> {
    void _query;
    // TODO: call SerpApi's eBay engine once the integration is built.
    return [];
  },
};
