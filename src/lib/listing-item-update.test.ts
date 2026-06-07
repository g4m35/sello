import { describe, expect, it } from "vitest";

import { ItemUpdateSchema } from "@/lib/listing-item-update";

describe("ItemUpdateSchema", () => {
  it("accepts a partial update with valid enums", () => {
    const res = ItemUpdateSchema.safeParse({
      brand: "Nike",
      category: "sneakers",
      condition: "used_excellent",
      size: "10.5",
    });
    expect(res.success).toBe(true);
  });

  it("coerces empty strings to null for nullable fields", () => {
    const res = ItemUpdateSchema.safeParse({ brand: "", size: "" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.brand).toBeNull();
      expect(res.data.size).toBeNull();
    }
  });

  it("rejects invalid category/condition enums", () => {
    expect(ItemUpdateSchema.safeParse({ category: "shoes" }).success).toBe(false);
    expect(ItemUpdateSchema.safeParse({ condition: "mint" }).success).toBe(false);
  });

  it("rejects unknown fields (strict)", () => {
    expect(ItemUpdateSchema.safeParse({ price: 100 }).success).toBe(false);
  });
});
