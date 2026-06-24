import { describe, expect, it } from "vitest";

import {
  buildListingExport,
  ExportMarketplaceSchema,
  type ListingExportInput,
} from "./export-formatters";

function input(overrides: Partial<ListingExportInput> = {}): ListingExportInput {
  return {
    productName: "Supreme Box Logo Hoodie",
    brand: "Supreme",
    size: "M",
    colorway: "Heather Grey",
    styleCode: "FW17-BOGO",
    category: "streetwear",
    condition: "used_good",
    title: "Supreme Box Logo Hoodie Heather Grey FW17",
    description: "Classic bogo hoodie in heather grey. Worn a handful of times.",
    bulletPoints: ["100% authentic", "FW17 release"],
    priceCents: 42000,
    itemSpecifics: {
      "Pit to Pit": "22 in",
      Length: "27 in",
      Flaws: "Small stain on left cuff",
    },
    tags: ["supreme", "box logo", "streetwear"],
    measurements: [],
    flaws: [],
    measurementProfile: "apparel_top",
    ...overrides,
  };
}

describe("structured measurements and flaws", () => {
  it("prefers structured measurements over itemSpecifics heuristics", () => {
    const result = buildListingExport(
      "grailed",
      input({
        measurements: [
          { label: "Pit to pit", value: "21.5", unit: "in" },
          { label: "Length", value: "27", unit: "in" },
        ],
      }),
    );

    expect(result.body).toContain("Pit to pit: 21.5 in");
    expect(result.body).toContain("Length: 27 in");
    expect(result.body).not.toContain("22 in");
    expect(result.warnings).toEqual([]);
  });

  it("never renders [measure] placeholders; apparel without values says available upon request", () => {
    const result = buildListingExport(
      "depop",
      input({
        measurements: [
          { label: "Sleeve", value: null, unit: "unknown" },
          { label: "Shoulder", value: null, unit: "unknown" },
        ],
        itemSpecifics: {},
      }),
    );

    expect(result.body).not.toContain("[measure]");
    expect(result.body).toContain("Measurements available upon request.");
    expect(result.warnings).toContain("No measurements saved yet");
  });

  it("renders only filled-in measurement values", () => {
    const result = buildListingExport(
      "poshmark",
      input({
        measurements: [
          { label: "Chest", value: "22", unit: "in" },
          { label: "Sleeve", value: null, unit: "unknown" },
        ],
        itemSpecifics: {},
      }),
    );

    expect(result.body).toContain("Chest: 22 in");
    expect(result.body).not.toContain("Sleeve");
    expect(result.body).not.toContain("[measure]");
    expect(result.warnings).not.toContain("No measurements saved yet");
  });

  it("prefers structured flaws with severity over itemSpecifics heuristics", () => {
    const result = buildListingExport(
      "grailed",
      input({
        flaws: [
          {
            label: "Cuff stain",
            description: "Light stain on the left cuff",
            severity: "minor",
          },
          { label: "Pilling", description: "Pilling around the hem" },
        ],
        itemSpecifics: {},
      }),
    );

    expect(result.body).toContain("Flaws:");
    expect(result.body).toContain("- Cuff stain: Light stain on the left cuff (minor)");
    expect(result.body).toContain("- Pilling: Pilling around the hem");
  });

  it("never claims the item has no flaws when none are recorded", () => {
    const result = buildListingExport(
      "depop",
      input({ flaws: [], itemSpecifics: { "Pit to Pit": "22 in" } }),
    );
    expect(result.body.toLowerCase()).not.toContain("no flaws");
    expect(result.body).not.toContain("Flaws:");
  });
})

describe("ExportMarketplaceSchema", () => {
  it("accepts only the copy-export marketplaces", () => {
    expect(ExportMarketplaceSchema.parse("depop")).toBe("depop");
    expect(ExportMarketplaceSchema.parse("poshmark")).toBe("poshmark");
    expect(ExportMarketplaceSchema.parse("grailed")).toBe("grailed");
    expect(ExportMarketplaceSchema.parse("etsy")).toBe("etsy");
    expect(ExportMarketplaceSchema.safeParse("ebay").success).toBe(false);
    expect(ExportMarketplaceSchema.safeParse("mercari").success).toBe(false);
  });
});

describe("buildListingExport depop", () => {
  it("formats a complete listing with casual sections and hashtags", () => {
    const result = buildListingExport("depop", input());

    expect(result.marketplace).toBe("depop");
    expect(result.title).toBe("Supreme Box Logo Hoodie Heather Grey FW17");
    expect(result.warnings).toEqual([]);

    expect(result.body).toContain(
      "Classic bogo hoodie in heather grey. Worn a handful of times.",
    );
    expect(result.body).toContain("Brand: Supreme");
    expect(result.body).toContain("Size: M");
    expect(result.body).toContain("Condition: Used — Good");
    expect(result.body).toContain("Price: $420");
    expect(result.body).toContain("Flaws: Small stain on left cuff");
    expect(result.body).toContain("Pit to Pit: 22 in");
    expect(result.body).toContain("Length: 27 in");

    const lastLine = result.body.trimEnd().split("\n").at(-1) ?? "";
    expect(lastLine.startsWith("#")).toBe(true);
    expect(lastLine).toContain("#supreme");
    expect(lastLine).toContain("#boxlogo");
    expect(lastLine.split(" ").length).toBeLessThanOrEqual(8);
  });

  it("derives a small hashtag set from brand and category when no tags exist", () => {
    const result = buildListingExport("depop", input({ tags: [] }));
    const lastLine = result.body.trimEnd().split("\n").at(-1) ?? "";
    expect(lastLine).toContain("#supreme");
    expect(lastLine).toContain("#streetwear");
  });
});

describe("buildListingExport poshmark", () => {
  it("formats labelled sections without hashtags", () => {
    const result = buildListingExport("poshmark", input());

    expect(result.marketplace).toBe("poshmark");
    expect(result.warnings).toEqual([]);
    expect(result.body).toContain("Brand: Supreme");
    expect(result.body).toContain("Size: M");
    expect(result.body).toContain("Condition: Used — Good");
    expect(result.body).toContain("Price: $420");
    expect(result.body).toContain("Measurements:");
    expect(result.body).toContain("Pit to Pit: 22 in");
    expect(result.body).toContain("Details:");
    expect(result.body).toContain("100% authentic");
    expect(result.body).toContain("Flaws: Small stain on left cuff");
    expect(result.body).not.toContain("#");
  });

  it("keeps the title within Poshmark's 80 character limit", () => {
    const longTitle = "Supreme Box Logo Pullover Hooded Sweatshirt Heather Grey FW17 Deadstock Authentic Streetwear";
    const result = buildListingExport("poshmark", input({ title: longTitle }));
    expect(result.title.length).toBeLessThanOrEqual(80);
  });
});

describe("buildListingExport grailed", () => {
  it("formats a direct menswear listing with tagged size and measurements", () => {
    const result = buildListingExport("grailed", input());

    expect(result.marketplace).toBe("grailed");
    expect(result.warnings).toEqual([]);
    expect(result.body).toContain("Brand: Supreme");
    expect(result.body).toContain("Tagged size: M");
    expect(result.body).toContain("Condition: Used — Good");
    expect(result.body).toContain("Price: $420");
    expect(result.body).toContain("Style code: FW17-BOGO");
    expect(result.body).toContain("Flaws: Small stain on left cuff");
    expect(result.body).toContain("Measurements:");
    expect(result.body).toContain("Pit to Pit: 22 in");
    expect(result.body).not.toContain("#");
  });
});

describe("missing-field warnings", () => {
  it("warns about each missing key field and notes apparel measurements are pending", () => {
    const result = buildListingExport(
      "depop",
      input({
        brand: null,
        size: null,
        priceCents: null,
        condition: "unknown",
        itemSpecifics: {},
      }),
    );

    expect(result.warnings).toContain("Missing brand");
    expect(result.warnings).toContain("Missing size");
    expect(result.warnings).toContain("Missing price");
    expect(result.warnings).toContain("Missing condition");
    expect(result.warnings).toContain("No measurements saved yet");
    expect(result.body).not.toContain("[measure]");
    expect(result.body).toContain("Measurements available upon request.");
  });

  it("does not demand garment measurements for sneakers", () => {
    const result = buildListingExport(
      "grailed",
      input({ category: "sneakers", measurementProfile: "shoes", itemSpecifics: {} }),
    );
    expect(result.warnings).not.toContain("No measurements saved yet");
    expect(result.body).not.toContain("[measure]");
    expect(result.body).not.toContain("Measurements");
  });

  it("does not add measurement filler for bags and accessories", () => {
    for (const profile of ["bag", "accessory"] as const) {
      const result = buildListingExport(
        "depop",
        input({ measurementProfile: profile, itemSpecifics: {} }),
      );
      expect(result.body).not.toContain("Measurements");
      expect(result.warnings).not.toContain("No measurements saved yet");
    }
  });

  it("never renders a missing size as a raw dash", () => {
    const poshmark = buildListingExport("poshmark", input({ size: null }));
    expect(poshmark.body).toContain("Size: Not specified");
    expect(poshmark.body).not.toContain("Size: —");

    const grailed = buildListingExport("grailed", input({ size: null }));
    expect(grailed.body).not.toContain("Tagged size");
  });

  it("warns when the description is empty", () => {
    const result = buildListingExport("poshmark", input({ description: "" }));
    expect(result.warnings).toContain("Missing description");
  });
});

describe("etsy copy-ready draft", () => {
  it("is a registered copy-ready export marketplace", () => {
    expect(ExportMarketplaceSchema.options).toContain("etsy");
  });

  it("renders the listing facts, keywords, and a photo checklist", () => {
    const result = buildListingExport("etsy", input());

    expect(result.marketplace).toBe("etsy");
    expect(result.title).toBe("Supreme Box Logo Hoodie Heather Grey FW17");
    expect(result.body).toContain("Brand: Supreme");
    expect(result.body).toContain("Condition: Used");
    expect(result.body).toContain("Quantity: 1");
    expect(result.body).toMatch(/Tags:.*supreme/i);
    expect(result.body).toContain("Photo checklist");
  });

  it("flags Etsy-specific required fields as Needs seller review instead of claiming publish-ready", () => {
    const result = buildListingExport("etsy", input());

    // Honest about what Sello cannot set automatically for Etsy.
    expect(result.body).toContain("Needs seller review");
    expect(result.body.toLowerCase()).toContain("shipping");
    expect(result.body.toLowerCase()).toContain("return");
    // Never asserts handmade/vintage eligibility on the seller's behalf.
    expect(result.body.toLowerCase()).toContain("who made it");
    expect(result.warnings).toContain("Needs seller review for Etsy-specific fields");
  });

  it("caps keyword tags at the Etsy maximum of 13", () => {
    const manyTags = Array.from({ length: 20 }, (_, i) => `keyword ${i}`);
    const result = buildListingExport("etsy", input({ tags: manyTags }));

    const tagLine = result.body
      .split("\n")
      .find((line) => line.startsWith("Tags:"));
    expect(tagLine).toBeDefined();
    const tagCount = tagLine!.replace("Tags:", "").split(",").filter((t) => t.trim()).length;
    expect(tagCount).toBeLessThanOrEqual(13);
  });

  it("still surfaces shared missing-field warnings", () => {
    const result = buildListingExport(
      "etsy",
      input({ brand: null, priceCents: null }),
    );
    expect(result.warnings).toContain("Missing brand");
    expect(result.warnings).toContain("Missing price");
  });
});

describe("fallbacks", () => {
  it("falls back to the product name when the draft title is empty", () => {
    const result = buildListingExport("depop", input({ title: "" }));
    expect(result.title).toBe("Supreme Box Logo Hoodie");
  });

  it("omits the flaws line when no flaws are recorded", () => {
    const result = buildListingExport(
      "grailed",
      input({ itemSpecifics: { "Pit to Pit": "22 in" } }),
    );
    expect(result.body).not.toContain("Flaws:");
  });
});
