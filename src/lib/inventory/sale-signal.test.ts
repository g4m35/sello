import { describe, expect, it } from "vitest";

import { classifyConfidence, handleSaleSignal, titleSimilarity } from "./sale-signal";
import { createInventoryFakePrisma, type FakeListing } from "./test-fake-prisma";

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    sellerId: "user-1",
    productName: "Nike Air Max 1 Patta Aqua",
    status: "LISTED" as const,
    soldAt: null,
    quantityAvailable: 1,
    soldSourceMarketplace: null,
    soldSourceListingId: null,
    lockVersion: 0,
    ...overrides,
  };
}

function listing(partial: Partial<FakeListing> & { id: string }): FakeListing {
  return {
    inventoryItemId: "item-1",
    marketplace: "grailed",
    status: "LISTED",
    externalListingId: null,
    externalUrl: null,
    titleSnapshot: "Nike Air Max 1 Patta Waves Aqua",
    ...partial,
  };
}

describe("confidence helpers", () => {
  it("bands by the documented thresholds", () => {
    expect(classifyConfidence(0.9)).toBe("high");
    expect(classifyConfidence(0.85)).toBe("high");
    expect(classifyConfidence(0.6)).toBe("medium");
    expect(classifyConfidence(0.5)).toBe("medium");
    expect(classifyConfidence(0.49)).toBe("low");
  });

  it("scores title similarity by token overlap", () => {
    expect(titleSimilarity("Nike Air Max 1", "Nike Air Max 1")).toBe(1);
    expect(titleSimilarity("Nike Air Max 1", "completely different shoe")).toBeLessThan(0.2);
  });
});

describe("handleSaleSignal", () => {
  it("high-confidence + exact match marks the item sold and queues delist", async () => {
    const prisma = createInventoryFakePrisma({
      items: [baseItem()],
      listings: [
        listing({ id: "l-grailed", marketplace: "grailed", externalListingId: "g-123" }),
        listing({ id: "l-depop", marketplace: "depop" }),
      ],
    });

    const result = await handleSaleSignal(prisma, {
      userId: "user-1",
      marketplace: "grailed",
      source: "api",
      externalListingId: "g-123",
      confidence: 0.95,
      price: 24000,
    });

    expect(result.outcome).toBe("marked_sold");
    expect(prisma._store.items[0].status).toBe("SOLD");
    expect(prisma._store.items[0].soldSourceMarketplace).toBe("grailed");
    // Delist queued for depop (the other live listing), not grailed (sold source).
    const queued = prisma._store.syncJobs.map(
      (j) => (j.payload as { marketplace: string }).marketplace,
    );
    expect(queued).toEqual(["depop"]);
    expect(prisma._store.events.some((e) => e.type === "sale_detected")).toBe(true);
  });

  it("medium-confidence creates a confirm_possible_sale task + notification and does NOT delist", async () => {
    const prisma = createInventoryFakePrisma({
      items: [baseItem()],
      listings: [
        listing({ id: "l-grailed", marketplace: "grailed", externalListingId: "g-123" }),
        listing({ id: "l-depop", marketplace: "depop" }),
      ],
    });

    const result = await handleSaleSignal(prisma, {
      userId: "user-1",
      marketplace: "grailed",
      source: "email",
      externalListingId: "g-123",
      confidence: 0.6,
    });

    expect(result.outcome).toBe("review_possible_sale");
    expect(prisma._store.items[0].status).toBe("LISTED");
    expect(prisma._store.syncJobs).toHaveLength(0);
    const task = prisma._store.reviewTasks[0];
    expect(task.type).toBe("confirm_possible_sale");
    expect(prisma._store.notifications[0].kind).toBe("possible_sale_confirm");
  });

  it("low-confidence but matched creates a confirm_possible_sale task only (no delist)", async () => {
    const prisma = createInventoryFakePrisma({
      items: [baseItem()],
      listings: [
        listing({ id: "l-grailed", marketplace: "grailed", externalListingId: "g-123" }),
      ],
    });

    const result = await handleSaleSignal(prisma, {
      userId: "user-1",
      marketplace: "grailed",
      source: "email",
      externalListingId: "g-123",
      confidence: 0.3,
    });

    expect(result.outcome).toBe("review_possible_sale");
    expect(prisma._store.items[0].status).toBe("LISTED");
    expect(prisma._store.syncJobs).toHaveLength(0);
    expect(prisma._store.reviewTasks[0].type).toBe("confirm_possible_sale");
  });

  it("unmatched signal creates an unmatched_marketplace_email task only (no delist, no item)", async () => {
    const prisma = createInventoryFakePrisma({
      items: [baseItem()],
      listings: [
        listing({ id: "l-grailed", marketplace: "grailed", externalListingId: "g-123" }),
      ],
    });

    const result = await handleSaleSignal(prisma, {
      userId: "user-1",
      marketplace: "depop",
      source: "email",
      externalListingId: "unknown-999",
      title: "totally unrelated product name xyz",
      confidence: 0.95,
    });

    expect(result.outcome).toBe("review_unmatched");
    expect(prisma._store.syncJobs).toHaveLength(0);
    const task = prisma._store.reviewTasks[0];
    expect(task.type).toBe("unmatched_marketplace_email");
    expect(task.inventoryItemId).toBeNull();
    expect(prisma._store.items[0].status).toBe("LISTED");
  });

  it("high-confidence but only a fuzzy title match does NOT auto-delist (asks to confirm)", async () => {
    const prisma = createInventoryFakePrisma({
      items: [baseItem()],
      listings: [
        listing({
          id: "l-grailed",
          marketplace: "grailed",
          titleSnapshot: "Nike Air Max 1 Patta Waves Aqua",
        }),
      ],
    });

    const result = await handleSaleSignal(prisma, {
      userId: "user-1",
      marketplace: "grailed",
      source: "email",
      title: "Nike Air Max 1 Patta Aqua",
      confidence: 0.95,
    });

    expect(result.outcome).toBe("review_possible_sale");
    expect(prisma._store.items[0].status).toBe("LISTED");
    expect(prisma._store.syncJobs).toHaveLength(0);
  });

  it("scopes matching to the requesting user (no cross-user match)", async () => {
    const prisma = createInventoryFakePrisma({
      items: [baseItem({ sellerId: "owner" })],
      listings: [
        listing({ id: "l-grailed", marketplace: "grailed", externalListingId: "g-123" }),
      ],
    });

    const result = await handleSaleSignal(prisma, {
      userId: "attacker",
      marketplace: "grailed",
      source: "api",
      externalListingId: "g-123",
      confidence: 0.95,
    });

    // The attacker can't match the owner's listing, so it falls through to unmatched.
    expect(result.outcome).toBe("review_unmatched");
    expect(prisma._store.items[0].status).toBe("LISTED");
  });
});
