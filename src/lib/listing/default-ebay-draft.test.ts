import { describe, expect, it } from "vitest";

import { applyDefaultEbayDraftFields } from "./default-ebay-draft";
import { readEbayDraftFields } from "./ebay-draft-fields";

describe("applyDefaultEbayDraftFields", () => {
  it("defaults the resale quantity to 1", () => {
    const out = applyDefaultEbayDraftFields({
      title: "Mystery item",
      brand: null,
      description: "",
      productCategory: "other",
      size: null,
      itemSpecifics: {},
      marketplaceDrafts: {},
    });
    expect(readEbayDraftFields(out).quantity).toBe(1);
  });

  it("infers a high-confidence eBay category from the AI classification", () => {
    const out = applyDefaultEbayDraftFields({
      title: "Nike Dunk Low Panda",
      brand: "Nike",
      description: "Deadstock pair with box.",
      productCategory: "sneakers",
      size: "10",
      itemSpecifics: {},
      marketplaceDrafts: {},
    });
    const ebay = readEbayDraftFields(out);
    expect(ebay.categoryId).toBe("15709");
    expect(ebay.quantity).toBe(1);
  });

  it("leaves the category unset when it cannot be resolved with confidence", () => {
    const out = applyDefaultEbayDraftFields({
      title: "Vintage mystery piece",
      brand: null,
      description: "An unusual item.",
      productCategory: "other",
      size: null,
      itemSpecifics: {},
      marketplaceDrafts: {},
    });
    // No fake confidence: an unresolved category stays empty so readiness shows
    // the exact missing field rather than guessing.
    expect(readEbayDraftFields(out).categoryId).toBeNull();
  });

  it("never overwrites a category or quantity the AI already provided", () => {
    const out = applyDefaultEbayDraftFields({
      title: "Nike Dunk Low Panda",
      brand: "Nike",
      description: "Deadstock pair with box.",
      productCategory: "sneakers",
      size: "10",
      itemSpecifics: {},
      marketplaceDrafts: { ebay: { categoryId: "99999", quantity: 3 } },
    });
    const ebay = readEbayDraftFields(out);
    expect(ebay.categoryId).toBe("99999");
    expect(ebay.quantity).toBe(3);
  });

  it("preserves other marketplaces' drafts", () => {
    const out = applyDefaultEbayDraftFields({
      title: "Nike Dunk Low Panda",
      brand: "Nike",
      description: "Deadstock pair with box.",
      productCategory: "sneakers",
      size: "10",
      itemSpecifics: {},
      marketplaceDrafts: { grailed: { title: "keep me" } },
    });
    expect((out.grailed as { title: string }).title).toBe("keep me");
  });
});
