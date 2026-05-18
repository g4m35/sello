import { describe, expect, it } from "vitest";

import {
  GeminiListingDraftSchema,
  parseGeminiListingDraft,
} from "./listing-draft";

const validDraft = {
  identification: {
    productName: "Nike SB Dunk Low Pro Chicago",
    brand: "Nike",
    category: "sneakers",
    styleCode: "BQ6817-600",
    colorway: "Varsity Red/Black/White",
    size: "US 10",
    condition: "used_good",
    confidence: 0.86,
    identifiers: ["Nike SB", "Dunk Low", "Chicago"],
    authenticationNotes: ["Check style code on box label and size tag."],
  },
  listingDraft: {
    title: "Nike SB Dunk Low Pro Chicago Size 10",
    description:
      "Authentic Nike SB Dunk Low Pro Chicago in used good condition. Includes the visible red, black, and white color blocking shown in photos.",
    bulletPoints: ["Nike SB Dunk Low Pro", "Chicago colorway", "Men's US 10"],
    itemSpecifics: {
      brand: "Nike",
      category: "Sneakers",
      size: "US 10",
      color: "Red/Black/White",
      condition: "Pre-owned",
    },
    recommendedPriceCents: 42500,
    pricingRationale:
      "Initial draft price only; verify live resale comps before publishing.",
    compSearchQueries: [
      "Nike SB Dunk Low Chicago BQ6817-600 size 10 sold",
      "Nike Dunk Low Chicago used size 10 resale comps",
    ],
  },
  marketplaceDrafts: {
    ebay: {
      title: "Nike SB Dunk Low Pro Chicago Size 10",
      description: "Pre-owned Nike SB Dunk Low Pro Chicago, size 10.",
      categoryHint: "Athletic Shoes",
      tags: ["Nike SB", "Dunk Low", "Chicago"],
    },
    grailed: {
      title: "Nike SB Dunk Low Pro Chicago",
      description: "Used Nike SB Dunk Low Pro Chicago in men's size 10.",
      categoryHint: "Sneakers",
      tags: ["nike-sb", "dunk-low", "chicago"],
    },
    poshmark: {
      title: "Nike SB Dunk Low Chicago",
      description: "Nike SB Dunk Low Pro Chicago sneakers, men's size 10.",
      categoryHint: "Shoes",
      tags: ["Nike", "Sneakers", "Streetwear"],
    },
    depop: {
      title: "Nike SB Dunk Low Pro Chicago",
      description: "Nike SB Dunk Low Chicago sneakers in used good condition.",
      categoryHint: "Sneakers",
      tags: ["nikesb", "dunk", "streetwear"],
    },
  },
  warnings: ["Confirm size and condition from additional photos before publishing."],
};

describe("GeminiListingDraftSchema", () => {
  it("accepts a complete structured marketplace draft", () => {
    expect(GeminiListingDraftSchema.parse(validDraft)).toMatchObject({
      identification: {
        brand: "Nike",
        category: "sneakers",
      },
      marketplaceDrafts: {
        ebay: {
          categoryHint: "Athletic Shoes",
        },
      },
    });
  });

  it("rejects unsupported marketplace draft keys", () => {
    const invalidDraft = {
      ...validDraft,
      marketplaceDrafts: {
        ...validDraft.marketplaceDrafts,
        stockx: {
          title: "Do not publish here",
          description: "Unsupported marketplace",
          categoryHint: "Sneakers",
          tags: ["stockx"],
        },
      },
    };

    expect(() => GeminiListingDraftSchema.parse(invalidDraft)).toThrow();
  });

  it("parses raw Gemini JSON and rejects markdown-wrapped responses", () => {
    expect(parseGeminiListingDraft(JSON.stringify(validDraft))).toEqual(validDraft);

    expect(() =>
      parseGeminiListingDraft(`\`\`\`json\n${JSON.stringify(validDraft)}\n\`\`\``),
    ).toThrow("Gemini returned non-JSON content.");
  });
});
