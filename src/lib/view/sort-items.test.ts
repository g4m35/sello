import { describe, expect, it } from "vitest";

import { sortItems } from "@/lib/view/sort-items";
import type { ItemView } from "@/lib/view/types";

function item(overrides: Partial<ItemView>): ItemView {
  return {
    id: "id",
    title: "Item",
    productName: "Item",
    brand: null,
    category: "other",
    condition: "unknown",
    size: null,
    colorway: null,
    priceCents: null,
    status: "draft",
    lifecycleState: "draft",
    statusLabel: "Draft",
    ready: false,
    missingCount: 0,
    photoCount: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
    draftId: null,
    channels: [],
    ...overrides,
  };
}

const a = item({ id: "a", title: "Bravo", priceCents: 3000, updatedAt: "2026-01-03T00:00:00.000Z" });
const b = item({ id: "b", title: "Alpha", priceCents: 1000, updatedAt: "2026-01-01T00:00:00.000Z" });
const c = item({ id: "c", title: "Charlie", priceCents: null, updatedAt: "2026-01-02T00:00:00.000Z" });
const list = [b, a, c];

describe("sortItems", () => {
  it("sorts by most recently updated", () => {
    expect(sortItems(list, "updated_desc").map((i) => i.id)).toEqual(["a", "c", "b"]);
  });
  it("sorts by oldest updated", () => {
    expect(sortItems(list, "updated_asc").map((i) => i.id)).toEqual(["b", "c", "a"]);
  });
  it("sorts by price high to low (no price last)", () => {
    expect(sortItems(list, "price_desc").map((i) => i.id)).toEqual(["a", "b", "c"]);
  });
  it("sorts by price low to high (no price first as -1)", () => {
    expect(sortItems(list, "price_asc").map((i) => i.id)).toEqual(["c", "b", "a"]);
  });
  it("sorts by title A to Z", () => {
    expect(sortItems(list, "title_asc").map((i) => i.id)).toEqual(["b", "a", "c"]);
  });
  it("does not mutate the input", () => {
    const input = [...list];
    sortItems(input, "title_asc");
    expect(input).toEqual(list);
  });
});
