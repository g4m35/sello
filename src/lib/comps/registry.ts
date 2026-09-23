import { apifyEbaySoldSource } from "@/lib/comps/sources/apify-ebay-sold";
import { ebayBrowseSource } from "@/lib/comps/sources/ebay-browse";
import { stockxSource } from "@/lib/comps/sources/stockx";
import type { CompSource } from "@/lib/comps/source";

// Implemented sources only. Sold results are preferred during pricing;
// active market levels remain context rather than completed-sale evidence.
// All are env-gated: a source with no configured credentials reports
// isEnabled() === false and is skipped, so nothing runs unless configured.
// TODO-only adapters are intentionally absent. Credentials and an enable flag
// cannot turn an empty implementation into an available comp provider.
export const COMP_SOURCES: CompSource[] = [
  stockxSource,
  apifyEbaySoldSource,
  ebayBrowseSource,
];

export function enabledCompSources(): CompSource[] {
  return COMP_SOURCES.filter((source) => source.isEnabled());
}
