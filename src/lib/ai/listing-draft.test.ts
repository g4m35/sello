import { describe, expect, it } from "vitest";

import {
  GeminiListingDraftSchema,
  geminiListingDraftResponseSchema,
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
    etsy: {
      title: "Nike SB Dunk Low Pro Chicago Size 10 Sneakers",
      description: "Pre-owned Nike SB Dunk Low Pro Chicago sneakers in men's size 10.",
      categoryHint: "Shoes > Sneakers & Athletic Shoes",
      tags: ["nike sb dunk", "chicago sneakers", "streetwear shoes"],
    },
  },
  warnings: ["Confirm size and condition from additional photos before publishing."],
};

describe("GeminiListingDraftSchema measurements and flaws", () => {
  it("accepts structured measurements and flaws", () => {
    const draft = {
      ...validDraft,
      listingDraft: {
        ...validDraft.listingDraft,
        measurements: [
          { label: "Insole length", value: "28", unit: "cm", confidence: 0.7 },
          { label: "Pit to pit", value: null, unit: "unknown" },
        ],
        flaws: [
          {
            label: "Heel drag",
            description: "Light tread wear on both heels",
            severity: "minor",
            confidence: 0.8,
          },
        ],
      },
    };

    const parsed = GeminiListingDraftSchema.parse(draft);
    expect(parsed.listingDraft.measurements).toHaveLength(2);
    expect(parsed.listingDraft.measurements[1].value).toBeNull();
    expect(parsed.listingDraft.flaws[0].severity).toBe("minor");
  });

  it("defaults measurements and flaws to empty arrays for older drafts", () => {
    const parsed = GeminiListingDraftSchema.parse(validDraft);
    expect(parsed.listingDraft.measurements).toEqual([]);
    expect(parsed.listingDraft.flaws).toEqual([]);
  });

  it("rejects invalid units and severities", () => {
    const badUnit = {
      ...validDraft,
      listingDraft: {
        ...validDraft.listingDraft,
        measurements: [{ label: "Chest", value: "21", unit: "feet" }],
      },
    };
    expect(() => GeminiListingDraftSchema.parse(badUnit)).toThrow();

    const badSeverity = {
      ...validDraft,
      listingDraft: {
        ...validDraft.listingDraft,
        flaws: [{ label: "Stain", description: "Small mark", severity: "catastrophic" }],
      },
    };
    expect(() => GeminiListingDraftSchema.parse(badSeverity)).toThrow();
  });
});

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
    expect(parseGeminiListingDraft(JSON.stringify(validDraft))).toEqual({
      ...validDraft,
      listingDraft: { ...validDraft.listingDraft, measurements: [], flaws: [] },
    });

    expect(() =>
      parseGeminiListingDraft(`\`\`\`json\n${JSON.stringify(validDraft)}\n\`\`\``),
    ).toThrow("Gemini returned non-JSON content.");
  });

  it("clips oversized generated authentication notes to the app limit", () => {
    const longNote = `${"Authentication details ".repeat(16)}Check tags and stitching.`;
    const parsed = parseGeminiListingDraft(
      JSON.stringify({
        ...validDraft,
        identification: {
          ...validDraft.identification,
          authenticationNotes: [longNote],
        },
      }),
    );

    expect(parsed.identification.authenticationNotes[0]).toHaveLength(240);
    expect(parsed.identification.authenticationNotes[0]).toBe(longNote.slice(0, 240));
  });

  it("advertises string length limits to Gemini", () => {
    expect(
      geminiListingDraftResponseSchema.properties.identification.properties.authenticationNotes
        .items,
    ).toMatchObject({ maxLength: "240" });
  });
});
