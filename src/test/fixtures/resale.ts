import type { GeminiListingDraft } from "@/lib/ai/listing-draft";
import type { PricingComp } from "@/lib/pricing/comps";
import type { ReadinessInput } from "@/lib/lifecycle/readiness";

// Shared, schema-shaped sample data for workflow tests. Kept in one place so
// schema drift breaks a single fixture instead of many ad-hoc literals.

export const geminiDraftFixture: GeminiListingDraft = {
  identification: {
    productName: "Nike SB Dunk Low Pro Chicago",
    brand: "Nike",
    category: "sneakers",
    styleCode: "BV1310-600",
    colorway: "Varsity Red/White",
    size: "US 10",
    condition: "used_excellent",
    confidence: 0.82,
    identifiers: ["BV1310-600"],
    authenticationNotes: ["Stitching and tongue tag consistent with retail pair."],
  },
  listingDraft: {
    title: "Nike SB Dunk Low Pro Chicago US 10 Used Excellent",
    description:
      "Authentic Nike SB Dunk Low Pro in the Chicago colorway, US 10, worn a handful of times. Original box included. No major flaws.",
    bulletPoints: [
      "Nike SB Dunk Low Pro",
      "Chicago colorway (BV1310-600)",
      "US 10, used excellent",
      "Original box included",
    ],
    itemSpecifics: {
      Brand: "Nike",
      Model: "SB Dunk Low Pro",
      Size: "US 10",
    },
    recommendedPriceCents: null,
    pricingRationale:
      "Pricing intentionally left for manual comps; no resale price invented.",
    compSearchQueries: ["nike sb dunk low chicago us 10 sold"],
    measurements: [
      { label: "Insole length", value: null, unit: "unknown", source: "ai" },
    ],
    flaws: [
      {
        label: "Sole yellowing",
        description: "Slight yellowing on the midsole edges",
        severity: "minor",
        confidence: 0.7,
        source: "ai",
      },
    ],
  },
  marketplaceDrafts: {
    ebay: {
      title: "Nike SB Dunk Low Pro Chicago US 10 Used Excellent",
      description: "Authentic pair, worn lightly, original box included.",
      categoryHint: "Athletic Shoes",
      tags: ["nike", "sb dunk", "chicago"],
    },
    grailed: {
      title: "Nike SB Dunk Low Pro Chicago US 10",
      description: "Authentic pair, worn lightly, original box included.",
      categoryHint: "Footwear",
      tags: ["nike", "sb dunk", "chicago"],
    },
    poshmark: {
      title: "Nike SB Dunk Low Pro Chicago US 10",
      description: "Authentic pair, worn lightly, original box included.",
      categoryHint: "Sneakers",
      tags: ["nike", "sbdunk", "chicago"],
    },
    depop: {
      title: "Nike SB Dunk Low Pro Chicago US 10",
      description: "Authentic pair, worn lightly, original box included.",
      categoryHint: "Sneakers",
      tags: ["nike", "sbdunk", "chicago"],
    },
  },
  warnings: ["Confirm authenticity in hand before shipping."],
};

export const priceCompFixtures: PricingComp[] = [
  { priceCents: 38000, shippingCents: 1500 },
  { priceCents: 41000, shippingCents: 0 },
  { priceCents: 44000, shippingCents: 1200 },
  { priceCents: 46000, shippingCents: 0 },
  { priceCents: 49000, shippingCents: 1800 },
];

export const invalidPriceCompFixtures: PricingComp[] = [
  { priceCents: 0, shippingCents: 0 },
  { priceCents: -1000, shippingCents: 0 },
  { priceCents: Number.NaN, shippingCents: 0 },
  { priceCents: 40000, shippingCents: -50 },
];

export function readinessInputFromFixture(
  overrides: Partial<ReadinessInput> = {},
): ReadinessInput {
  return {
    productName: geminiDraftFixture.identification.productName,
    title: geminiDraftFixture.listingDraft.title,
    description: geminiDraftFixture.listingDraft.description,
    bulletPoints: geminiDraftFixture.listingDraft.bulletPoints,
    selectedMarketplaces: ["ebay", "grailed"],
    recommendedPriceCents: null,
    ...overrides,
  };
}
