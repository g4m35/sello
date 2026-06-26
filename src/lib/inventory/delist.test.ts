import { describe, expect, it } from "vitest";

import { queueDelistOtherListings } from "./delist";
import { createInventoryFakePrisma, type FakeListing } from "./test-fake-prisma";

function baseItem() {
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

describe("queueDelistOtherListings", () => {
  it("skips the sold-source marketplace and queues the rest", async () => {
    const prisma = createInventoryFakePrisma({
      items: [baseItem()],
      listings: [
        listing({ id: "l-ebay", marketplace: "ebay", externalListingId: "e1" }),
        listing({ id: "l-grailed", marketplace: "grailed" }),
        listing({ id: "l-depop", marketplace: "depop" }),
      ],
    });

    const result = await queueDelistOtherListings(prisma, "item-1", "ebay", "user-1");

    expect(result.skippedSoldSource).toBe(true);
    // 2 non-eBay listings queued; the eBay (sold source) one skipped.
    expect(result.queuedJobIds).toHaveLength(2);
    const jobMarketplaces = prisma._store.syncJobs.map(
      (j) => (j.payload as { marketplace: string }).marketplace,
    );
    expect(jobMarketplaces).not.toContain("ebay");
    expect(jobMarketplaces).toEqual(expect.arrayContaining(["grailed", "depop"]));
  });

  it("queues an eBay delist as a normal queued job for a worker (adapter available)", async () => {
    const prisma = createInventoryFakePrisma({
      items: [baseItem()],
      listings: [
        listing({ id: "l-ebay", marketplace: "ebay", externalListingId: "e1" }),
      ],
    });

    // Sold on Grailed (assisted), so the eBay listing must be ended.
    const result = await queueDelistOtherListings(prisma, "item-1", "grailed", "user-1");

    expect(result.queuedJobIds).toHaveLength(1);
    expect(prisma._store.syncJobs[0].status).toBe("queued");
    expect((prisma._store.syncJobs[0].payload as { useAdapter: boolean }).useAdapter).toBe(
      true,
    );
    // No manual task for eBay — a worker handles it.
    expect(result.manualReviewTaskIds).toHaveLength(0);
  });

  it("parks a non-eBay listing as needs_review and creates a manual_delist_required task", async () => {
    const prisma = createInventoryFakePrisma({
      items: [baseItem()],
      listings: [
        listing({
          id: "l-poshmark",
          marketplace: "poshmark",
          externalUrl: "https://poshmark.com/listing/abc",
        }),
      ],
    });

    const result = await queueDelistOtherListings(prisma, "item-1", "ebay", "user-1");

    expect(prisma._store.syncJobs[0].status).toBe("needs_review");
    expect(result.manualReviewTaskIds).toHaveLength(1);
    const task = prisma._store.reviewTasks[0];
    expect(task.type).toBe("manual_delist_required");
    expect(task.marketplace).toBe("poshmark");
    // Instructions include the marketplace label and the listing URL.
    expect(task.description).toContain("Poshmark");
    expect(task.description).toContain("https://poshmark.com/listing/abc");
  });

  it("ignores listings that are not in an active-ish status", async () => {
    const prisma = createInventoryFakePrisma({
      items: [baseItem()],
      listings: [
        listing({ id: "l-sold", marketplace: "grailed", status: "SOLD" }),
        listing({ id: "l-delisted", marketplace: "depop", status: "DELISTED" }),
        listing({ id: "l-active", marketplace: "poshmark", status: "LISTED" }),
      ],
    });

    const result = await queueDelistOtherListings(prisma, "item-1", "ebay", "user-1");

    expect(result.queuedJobIds).toHaveLength(1);
    expect(prisma._store.syncJobs[0].marketplaceListingId).toBe("l-active");
  });

  it("is idempotent: calling twice creates no duplicate jobs or tasks", async () => {
    const prisma = createInventoryFakePrisma({
      items: [baseItem()],
      listings: [listing({ id: "l-poshmark", marketplace: "poshmark" })],
    });

    await queueDelistOtherListings(prisma, "item-1", "ebay", "user-1");
    await queueDelistOtherListings(prisma, "item-1", "ebay", "user-1");

    expect(prisma._store.syncJobs).toHaveLength(1);
    expect(prisma._store.reviewTasks).toHaveLength(1);
  });

  it("records a delist_requested inventory event per listing, never for the sold source", async () => {
    const prisma = createInventoryFakePrisma({
      items: [baseItem()],
      listings: [
        listing({ id: "l-ebay", marketplace: "ebay", externalListingId: "e1" }),
        listing({ id: "l-grailed", marketplace: "grailed" }),
      ],
    });

    await queueDelistOtherListings(prisma, "item-1", "ebay", "user-1");

    const delistEvents = prisma._store.events.filter((e) => e.type === "delist_requested");
    expect(delistEvents).toHaveLength(1);
    expect(delistEvents[0].marketplace).toBe("grailed");
  });

  it("does not act on an item owned by another user", async () => {
    const prisma = createInventoryFakePrisma({
      items: [baseItem()],
      listings: [listing({ id: "l-grailed", marketplace: "grailed" })],
    });

    const result = await queueDelistOtherListings(prisma, "item-1", "ebay", "other-user");

    expect(result.queuedJobIds).toHaveLength(0);
    expect(prisma._store.syncJobs).toHaveLength(0);
  });
});
