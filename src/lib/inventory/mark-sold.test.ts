import { describe, expect, it } from "vitest";

import { markItemSold } from "./mark-sold";
import { createInventoryFakePrisma, type FakeListing } from "./test-fake-prisma";

function baseItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    sellerId: "user-1",
    productName: "Nike Air Max 1",
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
    titleSnapshot: "Nike Air Max 1",
    ...partial,
  };
}

describe("markItemSold", () => {
  it("marks the item SOLD, zeroes quantity, bumps lockVersion, and queues delist for other platforms", async () => {
    const prisma = createInventoryFakePrisma({
      items: [baseItem()],
      listings: [
        listing({ id: "l-ebay", marketplace: "ebay", externalListingId: "e1" }),
        listing({ id: "l-grailed", marketplace: "grailed" }),
        listing({ id: "l-depop", marketplace: "depop" }),
      ],
    });

    const result = await markItemSold(prisma, {
      inventoryItemId: "item-1",
      userId: "user-1",
      soldMarketplace: "ebay",
      soldListingId: "e1",
      source: "manual",
    });

    expect(result.outcome).toBe("marked_sold");
    const item = prisma._store.items[0];
    expect(item.status).toBe("SOLD");
    expect(item.quantityAvailable).toBe(0);
    expect(item.soldSourceMarketplace).toBe("ebay");
    expect(item.soldSourceListingId).toBe("e1");
    expect(item.lockVersion).toBe(1);

    // Delist queued for the two OTHER marketplaces, never eBay (the sold source).
    expect(prisma._store.syncJobs).toHaveLength(2);
    const queuedMarketplaces = prisma._store.syncJobs.map(
      (j) => (j.payload as { marketplace: string }).marketplace,
    );
    expect(queuedMarketplaces).not.toContain("ebay");

    // A sale_confirmed audit event and a sold+delisting notification.
    expect(prisma._store.events.some((e) => e.type === "sale_confirmed")).toBe(true);
    expect(prisma._store.notifications[0].kind).toBe("sold_delisting");
  });

  it("is idempotent: marking sold twice from the same marketplace creates no duplicate delist jobs", async () => {
    const prisma = createInventoryFakePrisma({
      items: [baseItem()],
      listings: [
        listing({ id: "l-grailed", marketplace: "grailed" }),
        listing({ id: "l-depop", marketplace: "depop" }),
      ],
    });
    const input = {
      inventoryItemId: "item-1",
      userId: "user-1",
      soldMarketplace: "ebay" as const,
      source: "manual" as const,
    };

    await markItemSold(prisma, input);
    const second = await markItemSold(prisma, input);

    expect(second.outcome).toBe("already_sold");
    // Still only the 2 jobs from the first call — no duplicates.
    expect(prisma._store.syncJobs).toHaveLength(2);
  });

  it("creates a sync_conflict review task when already sold from a DIFFERENT source and never overwrites", async () => {
    const prisma = createInventoryFakePrisma({
      items: [
        baseItem({
          status: "SOLD",
          quantityAvailable: 0,
          soldSourceMarketplace: "ebay",
          soldSourceListingId: "e1",
          lockVersion: 1,
        }),
      ],
      listings: [listing({ id: "l-grailed", marketplace: "grailed" })],
    });

    const result = await markItemSold(prisma, {
      inventoryItemId: "item-1",
      userId: "user-1",
      soldMarketplace: "grailed",
      source: "api",
    });

    expect(result.outcome).toBe("conflict");
    // Sold source untouched.
    expect(prisma._store.items[0].soldSourceMarketplace).toBe("ebay");
    // A sync_conflict review task was created (not a delist).
    const conflict = prisma._store.reviewTasks.find((t) => t.type === "sync_conflict");
    expect(conflict).toBeTruthy();
    expect(prisma._store.syncJobs).toHaveLength(0);
    expect(prisma._store.events.some((e) => e.type === "sync_conflict")).toBe(true);
  });

  it("enforces ownership: a different user cannot mark another seller's item sold (404)", async () => {
    const prisma = createInventoryFakePrisma({
      items: [baseItem()],
      listings: [listing({ id: "l-grailed", marketplace: "grailed" })],
    });

    await expect(
      markItemSold(prisma, {
        inventoryItemId: "item-1",
        userId: "attacker",
        soldMarketplace: "ebay",
        source: "manual",
      }),
    ).rejects.toMatchObject({ status: 404 });

    // Nothing mutated.
    expect(prisma._store.items[0].status).toBe("LISTED");
    expect(prisma._store.syncJobs).toHaveLength(0);
  });

  it("handles a sold item with no recorded source: conflict, never overwrite", async () => {
    const prisma = createInventoryFakePrisma({
      items: [baseItem({ status: "SOLD", quantityAvailable: 0, lockVersion: 1 })],
    });

    const result = await markItemSold(prisma, {
      inventoryItemId: "item-1",
      userId: "user-1",
      soldMarketplace: "grailed",
      source: "api",
    });

    expect(result.outcome).toBe("conflict");
    expect(prisma._store.items[0].soldSourceMarketplace).toBeNull();
  });
});
