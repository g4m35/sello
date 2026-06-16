import { describe, expect, it } from "vitest";

import {
  ebayAspectRequirementsFromTaxonomy,
  ebayAspectRequirementsFor,
  resolveEbayAspects,
} from "./ebay-aspects";

describe("eBay aspect fallback rules", () => {
  it("requires common shoe specifics for Men's Athletic Shoes", () => {
    expect(ebayAspectRequirementsFor("15709")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Brand", label: "Brand", required: true }),
        expect.objectContaining({ name: "US Shoe Size", label: "Shoe size", required: true }),
        expect.objectContaining({ name: "Department", label: "Department (Men/Women)", required: true }),
        expect.objectContaining({ name: "Color", label: "Color", required: true }),
      ]),
    );
  });

  it("resolves required shoe aspects from Sello fields", () => {
    const result = resolveEbayAspects("15709", {
      brand: "Nike",
      size: "US 10",
      colorway: "Noise Aqua",
      department: "men",
      measurementProfile: "shoes",
      itemSpecifics: {},
      savedAspects: {},
    });

    expect(result.missingRequired).toEqual([]);
    expect(result.values).toMatchObject({
      Brand: "Nike",
      "US Shoe Size": "10",
      Department: "Men",
      Color: "Noise Aqua",
    });
  });

  it("uses friendly labels for missing required shoe details", () => {
    const result = resolveEbayAspects("15709", {
      brand: null,
      size: null,
      colorway: null,
      department: "unknown",
      measurementProfile: "shoes",
      itemSpecifics: {},
      savedAspects: {},
    });

    expect(result.missingRequired.map((aspect) => aspect.label)).toEqual([
      "Brand",
      "Shoe size",
      "Color",
    ]);
  });

  it("derives department from single-department shoe categories", () => {
    const result = resolveEbayAspects("15709", {
      brand: "Nike",
      size: "US 10",
      colorway: "Black",
      department: "unknown",
      measurementProfile: "shoes",
      itemSpecifics: {},
      savedAspects: {},
    });

    expect(result.missingRequired).toEqual([]);
    expect(result.values.Department).toBe("Men");
  });

  it("requires and auto-resolves known single-gender apparel aspects (57988)", () => {
    // eBay rejects publishOffer for Men's Jackets & Coats without Department, so
    // it must be a resolved required aspect (auto-filled "Men" from the category)
    // rather than dropped on the assumption that the category implies it.
    const requirements = ebayAspectRequirementsFor("57988");
    expect(requirements).toContainEqual(
      expect.objectContaining({ name: "Department", required: true }),
    );

    const result = resolveEbayAspects("57988", {
      brand: "The North Face",
      size: "S",
      colorway: "Black",
      department: "unknown",
      measurementProfile: "outerwear",
      itemSpecifics: {},
      savedAspects: {},
    });

    expect(result.missingRequired).toEqual([
      expect.objectContaining({ name: "Type", label: "Type" }),
    ]);
    expect(result.values.Department).toBe("Men");
    expect(result.values.Size).toBe("S");
    expect(result.values.Color).toBe("Black");
    expect(result.values["Size Type"]).toBe("Regular");
  });

  it("lets seller-saved aspect values satisfy missing requirements", () => {
    const result = resolveEbayAspects("15709", {
      brand: "Nike",
      size: null,
      colorway: "Black",
      department: "men",
      measurementProfile: "shoes",
      itemSpecifics: {},
      savedAspects: { "US Shoe Size": "10.5" },
    });

    expect(result.missingRequired).toEqual([]);
    expect(result.values["US Shoe Size"]).toBe("10.5");
  });

  it("preserves seller-saved Taxonomy aspects outside the local fallback list", () => {
    const result = resolveEbayAspects("57988", {
      brand: "The North Face",
      size: "S",
      colorway: "Black",
      department: "unknown",
      measurementProfile: "outerwear",
      itemSpecifics: {},
      savedAspects: {
        Type: "Puffer Jacket",
        Style: "Puffer Jacket",
        "Outer Shell Material": "Nylon",
      },
    });

    expect(result.missingRequired).toEqual([]);
    expect(result.values).toMatchObject({
      Type: "Puffer Jacket",
      Style: "Puffer Jacket",
      "Outer Shell Material": "Nylon",
    });
  });

  it("turns eBay Taxonomy metadata into required seller-facing aspects", () => {
    const requirements = ebayAspectRequirementsFromTaxonomy([
      {
        localizedAspectName: "Type",
        aspectConstraint: {
          aspectRequired: true,
          aspectUsage: "RECOMMENDED",
          aspectMode: "SELECTION_ONLY",
        },
        aspectValues: [
          { localizedValue: "Puffer Jacket" },
          { localizedValue: "Windbreaker" },
          { localizedValue: "Puffer Jacket" },
        ],
      },
      {
        localizedAspectName: "Style",
        aspectConstraint: { aspectRequired: false, aspectUsage: "OPTIONAL" },
      },
    ]);

    expect(requirements).toEqual([
      {
        name: "Type",
        label: "Type",
        required: true,
        selectionOnly: true,
        values: ["Puffer Jacket", "Windbreaker"],
      },
    ]);
  });

  it("does not invent item-specific apparel Type from Taxonomy requirements", () => {
    const result = resolveEbayAspects(
      "57988",
      {
        brand: "The North Face",
        size: "S",
        colorway: "Black",
        department: "unknown",
        measurementProfile: "outerwear",
        itemSpecifics: {},
        savedAspects: {},
      },
      {
        source: "taxonomy",
        requirements: [
          { name: "Brand", label: "Brand", required: true },
          { name: "Type", label: "Type", required: true, values: ["Puffer Jacket"] },
        ],
      },
    );

    expect(result.values.Brand).toBe("The North Face");
    expect(result.values.Type).toBeUndefined();
    expect(result.missingRequired).toEqual([
      expect.objectContaining({ name: "Type", label: "Type" }),
    ]);
  });
});
