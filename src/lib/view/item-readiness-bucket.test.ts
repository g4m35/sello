import { describe, expect, it } from "vitest";

import type { ItemView } from "./types";
import {
  inventoryDisplayBucket,
  isPublishReady,
  needsAttention,
} from "./item-readiness-bucket";

function makeItem(overrides: Partial<ItemView>): ItemView {
  return {
    id: "i",
    title: "t",
    productName: "t",
    brand: null,
    category: "sneakers",
    condition: "used_good",
    size: null,
    colorway: null,
    priceCents: 1000,
    status: "draft",
    lifecycleState: "draft",
    statusLabel: "Draft",
    ready: false,
    missingCount: 0,
    photoCount: 0,
    updatedAt: "2026-06-22T00:00:00.000Z",
    draftId: "d",
    channels: [],
    ...overrides,
  } as ItemView;
}

describe("item readiness bucket", () => {
  it("treats an approved + server-ready item as publish-ready", () => {
    const item = makeItem({ lifecycleState: "ready", ready: true });
    expect(isPublishReady(item)).toBe(true);
    expect(inventoryDisplayBucket(item)).toBe("ready");
    expect(needsAttention(item)).toBe(false);
  });

  it("does not treat an approved item that fails readiness as ready", () => {
    // e.g. an item approved before size was required, now missing its size.
    const item = makeItem({ lifecycleState: "ready", ready: false });
    expect(isPublishReady(item)).toBe(false);
    expect(inventoryDisplayBucket(item)).toBe("error");
    expect(needsAttention(item)).toBe(true);
  });

  it("keeps an incomplete draft in the draft bucket", () => {
    const item = makeItem({ lifecycleState: "draft", ready: false });
    expect(isPublishReady(item)).toBe(false);
    expect(inventoryDisplayBucket(item)).toBe("draft");
  });

  it("treats AI-failed items as needing attention", () => {
    const item = makeItem({ lifecycleState: "error", ready: false });
    expect(needsAttention(item)).toBe(true);
    expect(inventoryDisplayBucket(item)).toBe("error");
  });
});
