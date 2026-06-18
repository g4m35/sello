import { describe, expect, it } from "vitest";

import {
  analyzeListing,
  detectEbayCategoryConflict,
  EBAY_FASHION_CATEGORIES,
  type ListingIntelligenceInput,
} from "./intelligence";

function input(overrides: Partial<ListingIntelligenceInput> = {}): ListingIntelligenceInput {
  return {
    title: null,
    brand: null,
    description: null,
    productCategory: null,
    size: null,
    itemSpecifics: {},
    tags: [],
    savedEbayCategoryId: null,
    ...overrides,
  };
}

describe("eBay category inference", () => {
  it("infers Men's Athletic Shoes for men's/unclear sneakers", () => {
    for (const title of [
      "Nike Dunk Low Panda",
      "Jordan 4 Retro Bred",
      "Adidas Yeezy Boost 350",
      "New Balance 550 White Green",
      "Vintage running sneakers",
    ]) {
      const result = analyzeListing(input({ title }));
      expect(result.itemType).toBe("sneakers");
      expect(result.ebayCategory.resolvedId).toBe("15709");
      expect(result.ebayCategory.confidence).toBe("high");
      expect(result.ebayCategory.source).toBe("inferred");
    }
  });

  it("infers Women's Athletic Shoes from women's language or size", () => {
    const byText = analyzeListing(input({ title: "Nike Dunk Low women's 8" }));
    expect(byText.ebayCategory.resolvedId).toBe("95672");

    const bySize = analyzeListing(input({ title: "Nike Dunk Low", size: "8W" }));
    expect(bySize.ebayCategory.resolvedId).toBe("95672");
  });

  it("infers Men's Hoodies & Sweatshirts for hoodies/sweatshirts/crewnecks", () => {
    for (const title of ["Carhartt hoodie", "Champion sweatshirt", "Vintage crewneck"]) {
      const result = analyzeListing(input({ title }));
      expect(result.ebayCategory.resolvedId).toBe("155183");
      expect(result.ebayCategory.confidence).toBe("high");
    }
  });

  it("infers Men's T-Shirts for tees when department is men/unclear", () => {
    const result = analyzeListing(input({ title: "Supreme box logo tee" }));
    expect(result.ebayCategory.resolvedId).toBe("15687");
  });

  it("maps a crewneck T-shirt to T-Shirts, not Hoodies & Sweatshirts", () => {
    for (const title of [
      "Basic Black Crewneck T-Shirt Essential Tee",
      "Crewneck t-shirt",
      "Crew neck tee",
      "Short sleeve shirt",
    ]) {
      const result = analyzeListing(input({ title }));
      expect(result.itemType).toBe("tshirt");
      expect(result.ebayCategory.resolvedId).toBe("15687");
    }
  });

  it("maps a plain branded tee to T-Shirts", () => {
    const result = analyzeListing(input({ title: "Nike black tee" }));
    expect(result.itemType).toBe("tshirt");
    expect(result.ebayCategory.resolvedId).toBe("15687");
  });

  it("keeps crewneck sweatshirts and hoodies in Hoodies & Sweatshirts", () => {
    for (const title of [
      "Crewneck sweatshirt",
      "Pullover hoodie",
      "Champion hoodie",
    ]) {
      const result = analyzeListing(input({ title }));
      expect(result.itemType).toBe("hoodie");
      expect(result.ebayCategory.resolvedId).toBe("155183");
    }
  });
});

describe("eBay category conflict detection", () => {
  it("flags a T-shirt saved into the Hoodies & Sweatshirts category", () => {
    const result = analyzeListing(
      input({ title: "Basic black crewneck tee", savedEbayCategoryId: "155183" }),
    );
    expect(result.itemType).toBe("tshirt");
    const conflict = detectEbayCategoryConflict(result.itemType, result.ebayCategory.resolvedId);
    expect(conflict).not.toBeNull();
    expect(conflict?.detectedLabel).toBe("T-shirt");
    expect(conflict?.categoryName).toBe("Men's Hoodies & Sweatshirts");
  });

  it("returns no conflict when the category matches the item", () => {
    expect(detectEbayCategoryConflict("tshirt", "15687")).toBeNull();
    expect(detectEbayCategoryConflict("hoodie", "155183")).toBeNull();
    expect(detectEbayCategoryConflict("sneakers", "15709")).toBeNull();
  });

  it("does not flag ambiguous items or unknown categories", () => {
    expect(detectEbayCategoryConflict("other", "155183")).toBeNull();
    expect(detectEbayCategoryConflict("tshirt", null)).toBeNull();
    expect(detectEbayCategoryConflict("tshirt", "999999")).toBeNull();
  });

  it("infers jeans by department", () => {
    const mens = analyzeListing(input({ title: "Levi's 501 jeans men's 32x32" }));
    expect(mens.ebayCategory.resolvedId).toBe("11483");

    const womens = analyzeListing(input({ title: "Levi's women's jeans" }));
    expect(womens.ebayCategory.resolvedId).toBe("11554");
  });

  it("does not fake confidence for jeans without a department", () => {
    const result = analyzeListing(input({ title: "Levi's 501 jeans" }));
    expect(result.ebayCategory.resolvedId).toBeNull();
    expect(result.ebayCategory.confidence).toBe("low");
    expect(result.ebayCategory.suggestions.map((s) => s.id)).toEqual(
      expect.arrayContaining(["11483", "11554"]),
    );
  });

  it("infers Men's Jackets & Coats for jackets/puffers/bombers", () => {
    for (const title of ["North Face puffer", "Vintage bomber jacket", "Wool coat"]) {
      const result = analyzeListing(input({ title }));
      expect(result.ebayCategory.resolvedId).toBe("57988");
    }
  });

  it("infers Women's Dresses for dresses but not dress shirts or dress shoes", () => {
    expect(analyzeListing(input({ title: "Floral midi dress" })).ebayCategory.resolvedId).toBe(
      "63861",
    );
    expect(analyzeListing(input({ title: "Oxford dress shirt" })).itemType).not.toBe("dress");
    expect(analyzeListing(input({ title: "Leather dress shoes" })).itemType).not.toBe("dress");
  });

  it("returns no fake category for ambiguous items", () => {
    const result = analyzeListing(input({ title: "Mystery vintage thing" }));
    expect(result.ebayCategory.resolvedId).toBeNull();
    expect(result.ebayCategory.confidence).toBe("none");
    expect(result.ebayCategory.suggestions).toEqual([]);
  });

  it("always prefers a saved override over inference", () => {
    const result = analyzeListing(
      input({ title: "Nike Dunk Low", savedEbayCategoryId: "11483" }),
    );
    expect(result.ebayCategory.resolvedId).toBe("11483");
    expect(result.ebayCategory.source).toBe("saved");
  });

  it("uses the saved product category as a strong sneaker signal", () => {
    const result = analyzeListing(
      input({ title: "Air Trainer 97", productCategory: "sneakers" }),
    );
    expect(result.itemType).toBe("sneakers");
    expect(result.ebayCategory.resolvedId).toBe(EBAY_FASHION_CATEGORIES.mensAthleticShoes.id);
  });
});

describe("measurement profiles", () => {
  it("treats shoe size as size, never as clothing measurements", () => {
    const result = analyzeListing(input({ title: "Jordan 1 High", size: "US 10" }));
    expect(result.measurementProfile).toBe("shoes");
    expect(result.sizeRole).toBe("shoe_size");
    expect(result.recommendedMeasurements).toEqual([]);
  });

  it("suggests top measurements for tees and hoodies", () => {
    for (const title of ["Supreme tee", "Nike hoodie"]) {
      const result = analyzeListing(input({ title }));
      expect(result.recommendedMeasurements.map((m) => m.label)).toEqual([
        "Pit to pit",
        "Length",
        "Shoulders",
        "Sleeve",
      ]);
    }
  });

  it("suggests bottom measurements for jeans", () => {
    const result = analyzeListing(input({ title: "Men's selvedge jeans" }));
    expect(result.measurementProfile).toBe("apparel_bottom");
    expect(result.recommendedMeasurements.map((m) => m.label)).toEqual([
      "Waist",
      "Inseam",
      "Rise",
      "Leg opening",
    ]);
  });

  it("suggests outerwear measurements for jackets", () => {
    const result = analyzeListing(input({ title: "Patagonia fleece jacket" }));
    expect(result.measurementProfile).toBe("outerwear");
    expect(result.recommendedMeasurements.map((m) => m.label)).toContain("Pit to pit");
  });

  it("suggests dress measurements for dresses", () => {
    const result = analyzeListing(input({ title: "Silk slip dress" }));
    expect(result.measurementProfile).toBe("dress");
    expect(result.recommendedMeasurements.map((m) => m.label)).toEqual([
      "Bust",
      "Waist",
      "Length",
    ]);
  });

  it("never suggests clothing measurements for bags and accessories", () => {
    for (const title of ["Leather tote bag", "New Era fitted cap"]) {
      const result = analyzeListing(input({ title }));
      expect(result.recommendedMeasurements).toEqual([]);
    }
  });
});
