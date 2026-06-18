import { describe, expect, it } from "vitest";

import { mergeSavedItemState } from "./merge-item-state";
import { buildReadinessView } from "./readiness-view";
import type { ItemDetailView, ReadinessView } from "./types";

function readiness(overrides: Partial<ReadinessView> = {}): ReadinessView {
  return {
    ready: false,
    pct: 50,
    doneCount: 3,
    totalCount: 6,
    checks: [],
    ...overrides,
  };
}

function detail(overrides: Partial<ItemDetailView> = {}): ItemDetailView {
  return {
    id: "item-1",
    title: "Black Tee",
    productName: "Black Tee",
    brand: "Nike",
    category: "streetwear",
    condition: "used_good",
    size: "M",
    colorway: "Black",
    priceCents: null,
    status: "draft",
    lifecycleState: "draft",
    statusLabel: "Draft",
    photoCount: 2,
    updatedAt: "2026-06-17T00:00:00.000Z",
    draftId: "draft-1",
    channels: [],
    sku: null,
    description: "A clean black tee in great shape.",
    bulletPoints: ["one", "two", "three"],
    pricingRationale: null,
    measurements: [],
    flaws: [],
    ebayCategoryId: null,
    ebayQuantity: 1,
    ebayAspects: {},
    selectedMarketplaces: ["ebay"],
    readiness: readiness(),
    attempts: [],
    photos: [{ id: "p1", position: 0, url: "https://signed.example/p1" }],
    ...overrides,
  };
}

describe("mergeSavedItemState", () => {
  it("refreshes readiness/status/channels from the saved response", () => {
    const prev = detail({ status: "draft", statusLabel: "Draft" });
    const saved = detail({
      status: "ready",
      statusLabel: "Ready",
      lifecycleState: "ready",
      readiness: readiness({ ready: true, pct: 100, doneCount: 6 }),
      channels: [
        {
          marketplace: "ebay",
          name: "eBay",
          status: "ready",
          publishImplemented: false,
          environment: null,
          sku: null,
          externalOfferId: null,
          externalListingId: null,
          lastError: null,
        },
      ],
      priceCents: 2500,
    });

    const merged = mergeSavedItemState(prev, saved);

    expect(merged.readiness.ready).toBe(true);
    expect(merged.status).toBe("ready");
    expect(merged.statusLabel).toBe("Ready");
    expect(merged.lifecycleState).toBe("ready");
    expect(merged.priceCents).toBe(2500);
    expect(merged.channels).toHaveLength(1);
  });

  it("keeps the existing photos (signed URLs) and does not clobber local fields", () => {
    const prev = detail({
      photos: [{ id: "p1", position: 0, url: "https://signed.example/p1" }],
      description: "Locally edited description still in the form",
    });
    // A save response built without signed URLs would have url:null.
    const saved = detail({
      photos: [{ id: "p1", position: 0, url: null }],
      description: "stale server description",
    });

    const merged = mergeSavedItemState(prev, saved);

    expect(merged.photos[0].url).toBe("https://signed.example/p1");
    expect(merged.description).toBe("Locally edited description still in the form");
  });
});

describe("readiness reflects a saved price", () => {
  it("clears the missing-price check once a price is saved", () => {
    const before = buildReadinessView({
      productName: "Black Tee",
      title: "Black crewneck T-shirt, size M",
      description: "A clean black tee in great shape, barely worn.",
      bulletPoints: ["Soft cotton", "True to size", "No flaws"],
      selectedMarketplaces: ["ebay"],
      recommendedPriceCents: null,
      photoCount: 3,
    });
    const priceCheckBefore = before.checks.find((c) => c.id === "price");
    expect(priceCheckBefore?.state).toBe("miss");
    expect(before.ready).toBe(false);

    const after = buildReadinessView({
      productName: "Black Tee",
      title: "Black crewneck T-shirt, size M",
      description: "A clean black tee in great shape, barely worn.",
      bulletPoints: ["Soft cotton", "True to size", "No flaws"],
      selectedMarketplaces: ["ebay"],
      recommendedPriceCents: 2500,
      photoCount: 3,
    });
    const priceCheckAfter = after.checks.find((c) => c.id === "price");
    expect(priceCheckAfter?.state).toBe("done");
    expect(after.ready).toBe(true);
  });
});
