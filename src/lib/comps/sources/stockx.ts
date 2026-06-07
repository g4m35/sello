import type { CompQuery, CompSource, NormalizedComp } from "@/lib/comps/source";

// StockX API = sneaker/streetwear market data (last sale, bid/ask). Official
// partner access required. Disabled until STOCKX_API_KEY is configured.
export const stockxSource: CompSource = {
  id: "stockx",
  displayName: "StockX",
  sold: true,
  isEnabled() {
    return Boolean(process.env.STOCKX_API_KEY);
  },
  async fetchComps(_query: CompQuery): Promise<NormalizedComp[]> {
    void _query;
    // TODO: implement once StockX API partner access is granted.
    return [];
  },
};
