import { apifyEbaySoldSource } from "@/lib/comps/sources/apify-ebay-sold";
import { depopActiveSource } from "@/lib/comps/sources/depop-active";
import { ebayBrowseSource } from "@/lib/comps/sources/ebay-browse";
import { ebayMarketplaceInsightsSource } from "@/lib/comps/sources/ebay-marketplace-insights";
import { googleLensSource } from "@/lib/comps/sources/google-lens";
import { grailedSoldSource } from "@/lib/comps/sources/grailed-sold";
import { poshmarkSoldSource } from "@/lib/comps/sources/poshmark-sold";
import { stockxSource } from "@/lib/comps/sources/stockx";
import type { CompSource } from "@/lib/comps/source";

// Sold sources first (preferred), active/visual sources last (interim signals).
// All are env-gated: a source with no configured credentials reports
// isEnabled() === false and is skipped, so nothing runs unless configured.
// Note: eBay Marketplace Insights is intentionally absent (access restricted).
export const COMP_SOURCES: CompSource[] = [
  ebayMarketplaceInsightsSource,
  stockxSource,
  apifyEbaySoldSource,
  grailedSoldSource,
  poshmarkSoldSource,
  ebayBrowseSource,
  depopActiveSource,
  googleLensSource,
];

export function enabledCompSources(): CompSource[] {
  return COMP_SOURCES.filter((source) => source.isEnabled());
}
