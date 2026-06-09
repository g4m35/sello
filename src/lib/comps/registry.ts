import { ebayBrowseSource } from "@/lib/comps/sources/ebay-browse";
import { stockxSource } from "@/lib/comps/sources/stockx";
import type { CompSource } from "@/lib/comps/source";

// Sold source first (preferred), active-listing source last (interim signal).
// Note: eBay Marketplace Insights (sold comps) is no longer an option — eBay
// restricted access to it. StockX covers sold sneaker/streetwear data; eBay
// Browse provides an interim active-price signal.
export const COMP_SOURCES: CompSource[] = [stockxSource, ebayBrowseSource];

export function enabledCompSources(): CompSource[] {
  return COMP_SOURCES.filter((source) => source.isEnabled());
}
