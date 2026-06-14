import type { CompQuery, CompSource, NormalizedComp } from "@/lib/comps/source";

// Poshmark sold comps. Gated on POSHMARK_COMPS_API_KEY; returns [] until wired.
export const poshmarkSoldSource: CompSource = {
  id: "poshmark-sold",
  displayName: "Poshmark sold",
  sold: true,
  isEnabled() {
    return process.env.PRICE_COMP_POSHMARK_SOLD_ENABLED === "true" && Boolean(process.env.POSHMARK_COMPS_API_KEY);
  },
  async fetchComps(_query: CompQuery): Promise<NormalizedComp[]> {
    void _query;
    // TODO: implement once a Poshmark comp data source is available.
    return [];
  },
};
