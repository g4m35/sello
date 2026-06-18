import { describe, expect, it } from "vitest";

import { aspectControlKind, categoryConflictMessage } from "./ebay-preflight-card";

describe("aspectControlKind", () => {
  it("uses a dropdown when the aspect has a fixed value list", () => {
    expect(aspectControlKind({ values: ["Hoodie", "Sweatshirt"] })).toBe("select");
  });

  it("uses a free text field when there are no suggested values", () => {
    expect(aspectControlKind({})).toBe("text");
    expect(aspectControlKind({ values: [] })).toBe("text");
  });
});

describe("categoryConflictMessage", () => {
  it("asks the seller to confirm when the category disagrees with the item", () => {
    const message = categoryConflictMessage({
      detectedItemType: "tshirt",
      detectedLabel: "T-shirt",
      categoryId: "155183",
      categoryName: "Men's Hoodies & Sweatshirts",
    });
    expect(message).toBe(
      "This looks like a T-shirt, but the eBay category is Men's Hoodies & Sweatshirts. Change category?",
    );
  });
});
