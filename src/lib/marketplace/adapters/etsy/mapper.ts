// Maps a Sello listing into an Etsy Open API v3 createDraftListing body. The
// Etsy-specific decisions Sello cannot infer (taxonomy, shipping profile, who/when
// made, return policy) are inputs the seller supplies; this function only shapes
// and bounds the payload (Etsy tag/material limits, price as a major-unit float).

const ETSY_TITLE_MAX = 140;
const ETSY_TAG_MAX = 13;
const ETSY_TAG_CHAR_MAX = 20;
const ETSY_MATERIAL_MAX = 13;
const ETSY_MATERIAL_CHAR_MAX = 45;

export type EtsyListingMapInput = {
  title: string;
  description: string;
  priceCents: number;
  quantity: number;
  taxonomyId: number | string;
  shippingProfileId: number | string;
  returnPolicyId?: number | string | null;
  whoMade: string;
  whenMade: string;
  tags: string[];
  materials?: string[];
};

export function buildEtsyDraftBody(input: EtsyListingMapInput): Record<string, unknown> {
  return {
    quantity: input.quantity,
    title: input.title.trim().slice(0, ETSY_TITLE_MAX),
    description: input.description.trim(),
    // Etsy prices are major units in the shop currency, not cents.
    price: Math.round(input.priceCents) / 100,
    who_made: input.whoMade,
    when_made: input.whenMade,
    taxonomy_id: Number(input.taxonomyId),
    shipping_profile_id: Number(input.shippingProfileId),
    ...(present(input.returnPolicyId)
      ? { return_policy_id: Number(input.returnPolicyId) }
      : {}),
    type: "physical",
    state: "draft",
    tags: capList(input.tags, ETSY_TAG_MAX, ETSY_TAG_CHAR_MAX),
    ...(input.materials && input.materials.length > 0
      ? { materials: capList(input.materials, ETSY_MATERIAL_MAX, ETSY_MATERIAL_CHAR_MAX) }
      : {}),
  };
}

function capList(values: string[], maxCount: number, maxChars: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = value.trim().slice(0, maxChars).trim();
    if (cleaned.length < 1 || seen.has(cleaned.toLowerCase())) continue;
    seen.add(cleaned.toLowerCase());
    out.push(cleaned);
    if (out.length >= maxCount) break;
  }
  return out;
}

function present(value: number | string | null | undefined): boolean {
  if (value == null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return Number.isFinite(value);
}
