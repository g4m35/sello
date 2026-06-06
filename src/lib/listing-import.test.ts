import { describe, expect, it } from "vitest";

import {
  ImportRequestSchema,
  normalizeCategory,
  normalizeCondition,
} from "@/lib/listing-import";

describe("normalizeCondition", () => {
  it("passes through exact enum values", () => {
    expect(normalizeCondition("used_good")).toBe("used_good");
  });
  it("maps human phrasings", () => {
    expect(normalizeCondition("New With Tags")).toBe("new_with_tags");
    expect(normalizeCondition("Like New")).toBe("used_excellent");
    expect(normalizeCondition("Good")).toBe("used_good");
  });
  it("defaults to unknown", () => {
    expect(normalizeCondition(undefined)).toBe("unknown");
    expect(normalizeCondition("???")).toBe("unknown");
  });
});

describe("normalizeCategory", () => {
  it("maps sneakers and falls back to other", () => {
    expect(normalizeCategory("Sneakers")).toBe("sneakers");
    expect(normalizeCategory("shoe")).toBe("sneakers");
    expect(normalizeCategory("widget")).toBe("other");
  });
});

describe("ImportRequestSchema", () => {
  it("accepts valid rows", () => {
    const res = ImportRequestSchema.safeParse({
      rows: [{ title: "Air Jordan 1", priceCents: 42500 }],
    });
    expect(res.success).toBe(true);
  });
  it("rejects rows with an empty title", () => {
    const res = ImportRequestSchema.safeParse({ rows: [{ title: "" }] });
    expect(res.success).toBe(false);
  });
  it("rejects an empty batch", () => {
    const res = ImportRequestSchema.safeParse({ rows: [] });
    expect(res.success).toBe(false);
  });
});
