import type { CompQuery, CompSource, NormalizedComp } from "@/lib/comps/source";

// Google Lens visual search (visual_search source type). Gated on
// GOOGLE_LENS_API_KEY; returns [] until wired. Reports sold=false (visual
// matches are listings/links, not confirmed sales).
export const googleLensSource: CompSource = {
  id: "google-lens",
  displayName: "Google Lens",
  sold: false,
  isEnabled() {
    return Boolean(process.env.GOOGLE_LENS_API_KEY);
  },
  async fetchComps(_query: CompQuery): Promise<NormalizedComp[]> {
    void _query;
    // TODO: implement once a Google Lens / visual search provider is wired in.
    return [];
  },
};
