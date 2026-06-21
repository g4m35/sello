import { afterEach, describe, expect, it, vi } from "vitest";

import { mapAttempt, mapItem } from "./server-map";

function item() {
  const now = new Date("2026-06-11T12:00:00Z");
  return {
    id: "item-1",
    sellerId: "user-1",
    status: "APPROVED" as const,
    productName: "Nike Air Max 1",
    brand: "Nike",
    category: "sneakers" as const,
    condition: "new_with_tags" as const,
    styleCode: null,
    colorway: "Aqua",
    size: "US 10",
    confidence: null,
    recommendedPriceCents: 24000,
    pricingRationale: null,
    soldAt: null,
    createdAt: now,
    updatedAt: now,
    listingDrafts: [
      {
        id: "draft-1",
        inventoryItemId: "item-1",
        status: "APPROVED" as const,
        title: "Nike Air Max 1 Patta Waves Noise Aqua",
        description: "Ready listing.",
        bulletPoints: ["Nike", "Air Max", "Aqua"],
        recommendedPriceCents: 24000,
        pricingRationale: null,
        itemSpecifics: {},
        marketplaceDrafts: {},
        measurements: null,
        flaws: null,
        selectedMarketplaces: ["ebay" as const],
        approvedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    ],
    marketplaceListings: [],
    photos: [],
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("mapItem inventory visibility", () => {
  it("surfaces draft items with a Draft status so they appear in inventory", () => {
    const draftItem = { ...item(), status: "DRAFTING" as const };
    const view = mapItem(draftItem);
    expect(view.lifecycleState).toBe("draft");
    expect(view.statusLabel).toBe("Draft");
    expect(view.draftId).toBe("draft-1");
  });

  it("treats a not-yet-approved draft as a draft, never hidden", () => {
    const draftReady = { ...item(), status: "DRAFT_READY" as const };
    expect(mapItem(draftReady).lifecycleState).toBe("draft");
  });
});

describe("mapItem readiness (so lists can bucket accurately)", () => {
  function completeDraftItem() {
    const base = item();
    return {
      ...base,
      status: "DRAFT_READY" as const,
      listingDrafts: [
        {
          ...base.listingDrafts[0],
          description: "Authentic pair in great condition, barely worn. Ships fast.",
        },
      ],
    };
  }

  it("marks a readiness-complete draft as ready with zero missing fields", () => {
    const view = mapItem(completeDraftItem());
    expect(view.ready).toBe(true);
    expect(view.missingCount).toBe(0);
  });

  it("marks a draft missing a price as not ready and counts the gap", () => {
    const draft = completeDraftItem();
    const noPrice = {
      ...draft,
      recommendedPriceCents: null,
      listingDrafts: [{ ...draft.listingDrafts[0], recommendedPriceCents: null }],
    };
    const view = mapItem(noPrice);
    expect(view.ready).toBe(false);
    expect(view.missingCount).toBeGreaterThan(0);
  });
});

describe("mapItem publish channel gating", () => {
  it("hides live eBay publishing when the production flag is off", () => {
    vi.stubEnv("EBAY_ENV", "production");
    vi.stubEnv("EBAY_PRODUCTION_PUBLISH_ENABLED", "false");

    const ebay = mapItem(item()).channels.find((channel) => channel.marketplace === "ebay");

    expect(ebay?.publishImplemented).toBe(false);
  });

  it("shows live eBay publishing only when production flag is on in production", () => {
    vi.stubEnv("EBAY_ENV", "production");
    vi.stubEnv("EBAY_PRODUCTION_PUBLISH_ENABLED", "true");

    const ebay = mapItem(item()).channels.find((channel) => channel.marketplace === "ebay");

    expect(ebay?.publishImplemented).toBe(true);
  });

  it("keeps sandbox eBay publishing behavior on the adapter capability", () => {
    vi.stubEnv("EBAY_ENV", "sandbox");
    vi.stubEnv("EBAY_PRODUCTION_PUBLISH_ENABLED", "false");

    const ebay = mapItem(item()).channels.find((channel) => channel.marketplace === "ebay");

    expect(ebay?.publishImplemented).toBe(false);
  });
});

describe("mapAttempt bulk correlation", () => {
  it("extracts only the bulk run id from adapter metadata", () => {
    const now = new Date("2026-06-18T12:00:00Z");
    const view = mapAttempt({
      id: "attempt-1",
      status: "RUNNING",
      code: "EBAY_PUBLISH_STARTED",
      reason: null,
      adapterResult: {
        bulkRunId: "bulk-run-1",
        internalAdapterPayload: "do-not-expose",
      },
      startedAt: now,
      createdAt: now,
      completedAt: null,
      marketplaceListing: {
        marketplace: "ebay",
        environment: "sandbox",
        status: "NOT_LISTED",
        sku: null,
        externalOfferId: null,
        externalListingId: null,
        lastError: null,
        inventoryItem: {
          id: "item-1",
          productName: "Nike Air Max 1",
          listingDrafts: [],
        },
      },
    } as unknown as Parameters<typeof mapAttempt>[0]);

    expect(view.bulkRunId).toBe("bulk-run-1");
    expect(view).not.toHaveProperty("internalAdapterPayload");
  });
});

describe("mapAttempt failure sanitization (debug surfaces)", () => {
  it("scrubs raw persisted reason / ebayError / lastError before rendering", () => {
    const now = new Date("2026-06-18T12:00:00Z");
    const view = mapAttempt({
      id: "attempt-1",
      status: "FAILED",
      code: "EBAY_PUBLISH_FAILED",
      reason: "PrismaClientKnownRequestError: Authorization: Bearer leaked.token",
      adapterResult: {
        step: "publish",
        ebayError: {
          status: 500,
          message: '{"errors":[{"errorId":1,"message":"refresh_token=abc"}]}',
        },
      },
      startedAt: now,
      createdAt: now,
      completedAt: now,
      marketplaceListing: {
        marketplace: "ebay",
        environment: "production",
        status: "LISTED",
        sku: "percs_item1",
        externalOfferId: "off-1",
        externalListingId: "list-1",
        lastError: "Failed to deserialize column of type 'void'",
        inventoryItem: {
          id: "item-1",
          productName: "Nike Air Max 1",
          listingDrafts: [],
        },
      },
    } as unknown as Parameters<typeof mapAttempt>[0]);

    expect(view.reason).toBe("The marketplace request failed.");
    expect(view.listingLastError).toBe("The marketplace request failed.");
    expect(view.ebayErrorMessage).toBe("The marketplace request failed.");
    expect(view.ebayErrorStatus).toBe(500); // safe numeric status preserved

    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("refresh_token");
    expect(serialized).not.toContain("Prisma");
    expect(serialized).not.toContain("void");
    expect(serialized).not.toContain("leaked.token");
    expect(serialized).not.toMatch(/\{"errors"/);
  });
});
