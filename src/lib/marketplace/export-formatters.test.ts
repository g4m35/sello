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
    ...overrides,
  };
}

describe("ExportMarketplaceSchema", () => {
  it("accepts only the copy-export marketplaces", () => {
    expect(ExportMarketplaceSchema.parse("depop")).toBe("depop");
    expect(ExportMarketplaceSchema.parse("poshmark")).toBe("poshmark");
    expect(ExportMarketplaceSchema.parse("grailed")).toBe("grailed");
    expect(ExportMarketplaceSchema.safeParse("ebay").success).toBe(false);
    expect(ExportMarketplaceSchema.safeParse("etsy").success).toBe(false);
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
  it("warns about each missing key field and adds measurement placeholders", () => {
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
    expect(result.warnings).toContain("Missing measurements (placeholders added)");
    expect(result.body).toContain("Pit to pit: [measure]");
    expect(result.body).toContain("Length: [measure]");
  });

  it("does not demand garment measurements for sneakers", () => {
    const result = buildListingExport(
      "grailed",
      input({ category: "sneakers", itemSpecifics: {} }),
    );
    expect(result.warnings).not.toContain("Missing measurements (placeholders added)");
    expect(result.body).not.toContain("[measure]");
  });

  it("warns when the description is empty", () => {
    const result = buildListingExport("poshmark", input({ description: "" }));
    expect(result.warnings).toContain("Missing description");
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
