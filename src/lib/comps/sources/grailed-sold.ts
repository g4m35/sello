import type { CompQuery, CompSource, NormalizedComp } from "@/lib/comps/source";

// Grailed sold comps (streetwear/designer). Gated on GRAILED_COMPS_API_KEY;
// returns [] until a data provider is wired in.
export const grailedSoldSource: CompSource = {
  id: "grailed-sold",
  displayName: "Grailed sold",
  sold: true,
  isEnabled() {
    return process.env.PRICE_COMP_GRAILED_SOLD_ENABLED === "true" && Boolean(process.env.GRAILED_COMPS_API_KEY);
  },
  async fetchComps(_query: CompQuery): Promise<NormalizedComp[]> {
    void _query;
    // TODO: implement once a Grailed comp data source is available.
    return [];
  },
};
