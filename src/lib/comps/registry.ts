import { ebayBrowseSource } from "@/lib/comps/sources/ebay-browse";
import { ebayInsightsSource } from "@/lib/comps/sources/ebay-insights";
import { stockxSource } from "@/lib/comps/sources/stockx";
import type { CompSource } from "@/lib/comps/source";

// Sold sources first (preferred), active-listing source last (interim signal).
export const COMP_SOURCES: CompSource[] = [
  ebayInsightsSource,
  stockxSource,
  ebayBrowseSource,
];

export function enabledCompSources(): CompSource[] {
  return COMP_SOURCES.filter((source) => source.isEnabled());
}
