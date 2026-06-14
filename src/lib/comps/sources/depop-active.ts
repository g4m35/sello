import type { CompQuery, CompSource, NormalizedComp } from "@/lib/comps/source";

// Depop active listings (asking prices, not sales). Gated on DEPOP_COMPS_API_KEY;
// returns [] until wired.
export const depopActiveSource: CompSource = {
  id: "depop-active",
  displayName: "Depop (active listings)",
  sold: false,
  resultKind: "active_listings",
  isEnabled() {
    return process.env.PRICE_COMP_DEPOP_ACTIVE_ENABLED === "true" && Boolean(process.env.DEPOP_COMPS_API_KEY);
  },
  async fetchComps(_query: CompQuery): Promise<NormalizedComp[]> {
    void _query;
    // TODO: implement once a Depop comp data source is available.
    return [];
  },
};
