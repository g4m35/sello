import { describe, expect, it, vi } from "vitest";

import { EbayIntegrationError } from "@/lib/marketplace/adapters/ebay/errors";
import {
  createInventoryFakePrisma,
  type FakeItem,
  type FakeListing,
  type FakePrisma,
} from "@/lib/inventory/test-fake-prisma";

import {
  claimQueuedSyncJobs,
  requeueStaleRunningSyncJobs,
  runQueuedSyncJobs,
  runSyncJob,
  type SyncWorkerPrismaLike,
} from "./worker";

// The worker fake mirrors the engine fake's casting pattern. executeEbayDelist is
// always injected as a mock so no eBay adapter/route code or live call is touched.
function workerDb(prisma: FakePrisma): SyncWorkerPrismaLike {
  return prisma as unknown as SyncWorkerPrismaLike;
}

function item(overrides: Partial<FakeItem> = {}): FakeItem {
  return {
    id: "item-1",
    sellerId: "user-1",
    productName: "Nike Air Max 1",
    status: "LISTED",
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
    marketplace: "ebay",
    status: "LISTED",
    externalListingId: null,
    externalUrl: null,
    titleSnapshot: "Nike Air Max 1",
    endedAt: null,
    ...partial,
  };
}

describe("claimQueuedSyncJobs", () => {
  it("claims only queued + due jobs and never a future runAfter job", async () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);
    const prisma = createInventoryFakePrisma({
      items: [item()],
      syncJobs: [
        { id: "j-queued", userId: "user-1", type: "notify_user", status: "queued" },
        { id: "j-due", userId: "user-1", type: "notify_user", status: "queued", runAfter: past },
        { id: "j-future", userId: "user-1", type: "notify_user", status: "queued", runAfter: future },
        { id: "j-running", userId: "user-1", type: "notify_user", status: "running" },
        { id: "j-succeeded", userId: "user-1", type: "notify_user", status: "succeeded" },
      ],
    });

    const claimed = await claimQueuedSyncJobs(workerDb(prisma), { limit: 10 });
    const ids = claimed.map((j) => j.id).sort();

    expect(ids).toEqual(["j-due", "j-queued"]);
    // Future job stays queued, untouched.
    const futureJob = prisma._store.syncJobs.find((j) => j.id === "j-future");
    expect(futureJob?.status).toBe("queued");
    // Claimed jobs are now running with attempts incremented.
    const claimedJob = prisma._store.syncJobs.find((j) => j.id === "j-queued");
    expect(claimedJob?.status).toBe("running");
    expect(claimedJob?.attempts).toBe(1);
  });

  it("caps the claim batch at the safe limit", async () => {
    const seed = Array.from({ length: 30 }, (_, i) => ({
      id: `j-${i}`,
      userId: "user-1",
      type: "notify_user" as const,
      status: "queued" as const,
    }));
    const prisma = createInventoryFakePrisma({ items: [item()], syncJobs: seed });

    const claimed = await claimQueuedSyncJobs(workerDb(prisma), { limit: 999 });
    // Hard cap of 25 regardless of requested limit.
    expect(claimed).toHaveLength(25);
  });

  it("two concurrent claims of the same job: only one wins (count===1)", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      syncJobs: [
        { id: "j-1", userId: "user-1", type: "notify_user", status: "queued" },
      ],
    });
    const db = workerDb(prisma);

    // Worker A claims via the engine path.
    const [a] = await claimQueuedSyncJobs(db, { limit: 10 });
    expect(a?.id).toBe("j-1");

    // Worker B tries to claim the same job afterwards: it's no longer queued, so
    // the conditional updateMany matches nothing and B claims nothing.
    const b = await claimQueuedSyncJobs(db, { limit: 10 });
    expect(b).toHaveLength(0);

    // The direct race guard: a second conditional claim returns count 0.
    const second = await prisma._store.syncJobs;
    expect(second.find((j) => j.id === "j-1")?.attempts).toBe(1);
  });
});

describe("runSyncJob — maxAttempts (no endless retry)", () => {
  it("a failing job at attempts >= maxAttempts ends 'failed', not re-queued", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      listings: [listing({ id: "l-ebay", marketplace: "ebay", externalListingId: "e1" })],
      syncJobs: [
        {
          id: "j-1",
          userId: "user-1",
          type: "delist_marketplace_listing",
          status: "queued",
          inventoryItemId: "item-1",
          marketplaceListingId: "l-ebay",
          attempts: 4,
          maxAttempts: 5,
          payload: {
            inventoryItemId: "item-1",
            marketplaceListingId: "l-ebay",
            marketplace: "ebay",
            soldMarketplace: "grailed",
          },
        },
      ],
    });
    const db = workerDb(prisma);

    // Claim bumps attempts 4 -> 5 (== maxAttempts). The eBay delist then throws.
    const ebayDelist = vi.fn().mockRejectedValue(
      new EbayIntegrationError("EBAY_DELIST_FAILED", "not delistable", 409),
    );

    const [claimed] = await claimQueuedSyncJobs(db, { limit: 10 });
    const result = await runSyncJob(db, claimed.id, { ebayDelist });

    expect(result.status).toBe("failed");
    const job = prisma._store.syncJobs.find((j) => j.id === "j-1");
    expect(job?.status).toBe("failed");
    expect(job?.attempts).toBe(5);
  });
});

describe("runSyncJob — delist_marketplace_listing (eBay)", () => {
  function ebayJobSeed() {
    return {
      id: "j-1",
      userId: "user-1",
      type: "delist_marketplace_listing" as const,
      status: "queued" as const,
      inventoryItemId: "item-1",
      marketplaceListingId: "l-ebay",
      payload: {
        inventoryItemId: "item-1",
        marketplaceListingId: "l-ebay",
        marketplace: "ebay",
        soldMarketplace: "grailed",
        useAdapter: true,
      },
    };
  }

  it("success: delist_succeeded event + endedAt set + job succeeded", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      listings: [listing({ id: "l-ebay", marketplace: "ebay", externalListingId: "e1" })],
      syncJobs: [ebayJobSeed()],
    });
    const db = workerDb(prisma);
    const ebayDelist = vi.fn().mockResolvedValue({ ok: true });

    const summary = await runQueuedSyncJobs(db, { limit: 10 }, { ebayDelist });

    expect(summary).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(ebayDelist).toHaveBeenCalledTimes(1);
    expect(ebayDelist.mock.calls[0][1]).toMatchObject({
      userId: "user-1",
      inventoryItemId: "item-1",
      confirmLiveDelist: true,
    });
    expect(prisma._store.syncJobs[0].status).toBe("succeeded");
    expect(prisma._store.listings[0].endedAt).toBeInstanceOf(Date);
    expect(prisma._store.events.some((e) => e.type === "delist_succeeded")).toBe(true);
  });

  it("a successfully-cleaned-up SOLD item stays SOLD (restores status after master-flip)", async () => {
    const prisma = createInventoryFakePrisma({
      // Item already sold on grailed; an eBay cleanup delist is queued.
      items: [
        item({
          status: "SOLD",
          soldAt: new Date(),
          quantityAvailable: 0,
          soldSourceMarketplace: "grailed",
          soldSourceListingId: "g1",
          lockVersion: 1,
        }),
      ],
      listings: [listing({ id: "l-ebay", marketplace: "ebay", externalListingId: "e1" })],
      syncJobs: [ebayJobSeed()],
    });
    const db = workerDb(prisma);
    // Simulate executeEbayDelist's internal syncMasterStatusAfterMarketplaceDelist
    // overwriting the master status back to DELISTED.
    const ebayDelist = vi.fn().mockImplementation(async () => {
      prisma._store.items[0].status = "DELISTED";
      return { ok: true };
    });

    const summary = await runQueuedSyncJobs(db, { limit: 10 }, { ebayDelist });

    expect(summary).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(ebayDelist).toHaveBeenCalledTimes(1);
    // The worker re-read the sold item and restored SOLD after the master flip.
    expect(prisma._store.items[0].status).toBe("SOLD");
    // The listing was actually ended (endedAt stamped).
    expect(prisma._store.listings[0].endedAt).toBeInstanceOf(Date);
  });

  it("a NON-sold item is left as executeEbayDelist set it (no forced SOLD)", async () => {
    const prisma = createInventoryFakePrisma({
      // Not sold: soldSourceMarketplace null. A delist is a normal lifecycle delist.
      items: [item({ status: "LISTED", soldSourceMarketplace: null })],
      listings: [listing({ id: "l-ebay", marketplace: "ebay", externalListingId: "e1" })],
      syncJobs: [ebayJobSeed()],
    });
    const db = workerDb(prisma);
    const ebayDelist = vi.fn().mockImplementation(async () => {
      prisma._store.items[0].status = "DELISTED";
      return { ok: true };
    });

    const summary = await runQueuedSyncJobs(db, { limit: 10 }, { ebayDelist });

    expect(summary).toMatchObject({ claimed: 1, succeeded: 1 });
    // No sold source => the worker must NOT force SOLD; the delist result stands.
    expect(prisma._store.items[0].status).toBe("DELISTED");
  });

  it("eBay error: delist_failed event + manual task + needs_review (NEVER fake success)", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      listings: [listing({ id: "l-ebay", marketplace: "ebay", externalListingId: "e1" })],
      syncJobs: [ebayJobSeed()],
    });
    const db = workerDb(prisma);
    const ebayDelist = vi.fn().mockRejectedValue(
      new EbayIntegrationError("EBAY_DELIST_FAILED", "No published eBay listing", 409),
    );

    const summary = await runQueuedSyncJobs(db, { limit: 10 }, { ebayDelist });

    expect(summary).toMatchObject({ claimed: 1, needsReview: 1 });
    expect(prisma._store.syncJobs[0].status).toBe("needs_review");
    expect(prisma._store.events.some((e) => e.type === "delist_failed")).toBe(true);
    // endedAt NOT set — the listing was not actually delisted.
    expect(prisma._store.listings[0].endedAt).toBeNull();
    const task = prisma._store.reviewTasks.find((t) => t.type === "manual_delist_required");
    expect(task).toBeTruthy();
  });

  it("sanitizes the persisted failure message (no raw provider text)", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      listings: [listing({ id: "l-ebay", marketplace: "ebay", externalListingId: "e1" })],
      syncJobs: [ebayJobSeed()],
    });
    const db = workerDb(prisma);
    const ebayDelist = vi.fn().mockRejectedValue(
      new Error('Bearer abc.def secret token at /app/x.ts:1:2 {"k":1}'),
    );

    await runQueuedSyncJobs(db, { limit: 10 }, { ebayDelist });

    const job = prisma._store.syncJobs[0];
    expect(job.errorMessage).not.toContain("Bearer");
    expect(job.errorMessage).not.toContain("secret");
    const event = prisma._store.events.find((e) => e.type === "delist_failed");
    expect(JSON.stringify(event?.payload)).not.toContain("Bearer");
  });

  it("already-DELISTED listing: job succeeds, no eBay call", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      listings: [listing({ id: "l-ebay", marketplace: "ebay", status: "DELISTED" })],
      syncJobs: [ebayJobSeed()],
    });
    const db = workerDb(prisma);
    const ebayDelist = vi.fn();

    const summary = await runQueuedSyncJobs(db, { limit: 10 }, { ebayDelist });

    expect(summary).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(ebayDelist).not.toHaveBeenCalled();
    expect(prisma._store.syncJobs[0].status).toBe("succeeded");
  });

  it("listing on the sold-source marketplace is skipped (never delisted)", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      listings: [listing({ id: "l-ebay", marketplace: "ebay", externalListingId: "e1" })],
      syncJobs: [
        {
          ...ebayJobSeed(),
          payload: {
            inventoryItemId: "item-1",
            marketplaceListingId: "l-ebay",
            marketplace: "ebay",
            // Sold ON eBay: the eBay listing itself must NOT be delisted.
            soldMarketplace: "ebay",
          },
        },
      ],
    });
    const db = workerDb(prisma);
    const ebayDelist = vi.fn();

    const summary = await runQueuedSyncJobs(db, { limit: 10 }, { ebayDelist });

    expect(summary).toMatchObject({ claimed: 1, skipped: 1 });
    expect(ebayDelist).not.toHaveBeenCalled();
    expect(prisma._store.syncJobs[0].status).toBe("skipped");
  });

  it("idempotent: a second worker run does not re-run a terminal job", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      listings: [listing({ id: "l-ebay", marketplace: "ebay", externalListingId: "e1" })],
      syncJobs: [ebayJobSeed()],
    });
    const db = workerDb(prisma);
    const ebayDelist = vi.fn().mockResolvedValue({ ok: true });

    await runQueuedSyncJobs(db, { limit: 10 }, { ebayDelist });
    const second = await runQueuedSyncJobs(db, { limit: 10 }, { ebayDelist });

    // Nothing left to claim; eBay called exactly once total.
    expect(second.claimed).toBe(0);
    expect(ebayDelist).toHaveBeenCalledTimes(1);
    const delistEvents = prisma._store.events.filter((e) => e.type === "delist_succeeded");
    expect(delistEvents).toHaveLength(1);
  });
});

describe("runSyncJob — delist_marketplace_listing (StockX)", () => {
  function stockxJobSeed() {
    return {
      id: "j-1",
      userId: "user-1",
      type: "delist_marketplace_listing" as const,
      status: "queued" as const,
      inventoryItemId: "item-1",
      marketplaceListingId: "l-stockx",
      payload: {
        inventoryItemId: "item-1",
        marketplaceListingId: "l-stockx",
        marketplace: "stockx",
        soldMarketplace: "ebay",
        useAdapter: true,
      },
    };
  }

  it("success: delist_succeeded event + endedAt set + job succeeded", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      listings: [
        listing({
          id: "l-stockx",
          marketplace: "stockx",
          externalListingId: "stockx-listing-1",
        }),
      ],
      syncJobs: [stockxJobSeed()],
    });
    const db = workerDb(prisma);
    const stockxDelist = vi.fn().mockResolvedValue({ ok: true });

    const summary = await runQueuedSyncJobs(db, { limit: 10 }, { stockxDelist });

    expect(summary).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(stockxDelist).toHaveBeenCalledTimes(1);
    expect(stockxDelist.mock.calls[0][1]).toMatchObject({
      userId: "user-1",
      inventoryItemId: "item-1",
      confirmLiveDelist: true,
    });
    expect(prisma._store.syncJobs[0].status).toBe("succeeded");
    expect(prisma._store.listings[0].endedAt).toBeInstanceOf(Date);
    expect(prisma._store.events.some((e) => e.type === "delist_succeeded")).toBe(true);
  });

  it("runs StockX delist jobs scoped to a shared account", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item({ sellerId: "owner-1", accountId: "account-1" })],
      listings: [
        listing({
          id: "l-stockx",
          marketplace: "stockx",
          externalListingId: "stockx-listing-1",
        }),
      ],
      syncJobs: [
        {
          ...stockxJobSeed(),
          userId: "member-1",
          payload: {
            inventoryItemId: "item-1",
            marketplaceListingId: "l-stockx",
            marketplace: "stockx",
            soldMarketplace: "ebay",
            useAdapter: true,
            accountId: "account-1",
          },
        },
      ],
    });
    const db = workerDb(prisma);
    const stockxDelist = vi.fn().mockResolvedValue({ ok: true });

    const summary = await runQueuedSyncJobs(db, { limit: 10 }, { stockxDelist });

    expect(summary).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(stockxDelist).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        userId: "member-1",
        accountId: "account-1",
        inventoryItemId: "item-1",
        confirmLiveDelist: true,
      }),
    );
    expect(prisma._store.listings[0].endedAt).toBeInstanceOf(Date);
  });

  it("StockX error: delist_failed event + manual task + needs_review", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      listings: [
        listing({
          id: "l-stockx",
          marketplace: "stockx",
          externalListingId: "stockx-listing-1",
        }),
      ],
      syncJobs: [stockxJobSeed()],
    });
    const db = workerDb(prisma);
    const stockxDelist = vi.fn().mockRejectedValue(
      new Error("StockX provider text token=secret"),
    );

    const summary = await runQueuedSyncJobs(db, { limit: 10 }, { stockxDelist });

    expect(summary).toMatchObject({ claimed: 1, needsReview: 1 });
    expect(prisma._store.syncJobs[0].status).toBe("needs_review");
    expect(prisma._store.events.some((e) => e.type === "delist_failed")).toBe(true);
    expect(prisma._store.listings[0].endedAt).toBeNull();
    const task = prisma._store.reviewTasks.find((t) => t.type === "manual_delist_required");
    expect(task?.marketplace).toBe("stockx");
    expect(JSON.stringify(prisma._store)).not.toContain("token=secret");
  });

  it("listing sold on StockX is skipped rather than deactivated", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      listings: [
        listing({
          id: "l-stockx",
          marketplace: "stockx",
          externalListingId: "stockx-listing-1",
        }),
      ],
      syncJobs: [
        {
          ...stockxJobSeed(),
          payload: {
            inventoryItemId: "item-1",
            marketplaceListingId: "l-stockx",
            marketplace: "stockx",
            soldMarketplace: "stockx",
          },
        },
      ],
    });
    const db = workerDb(prisma);
    const stockxDelist = vi.fn();

    const summary = await runQueuedSyncJobs(db, { limit: 10 }, { stockxDelist });

    expect(summary).toMatchObject({ claimed: 1, skipped: 1 });
    expect(stockxDelist).not.toHaveBeenCalled();
    expect(prisma._store.syncJobs[0].status).toBe("skipped");
  });
});

describe("runSyncJob — delist_marketplace_listing (non-eBay defensive)", () => {
  it("never fakes a delist: parks a manual task + needs_review", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      listings: [
        listing({
          id: "l-posh",
          marketplace: "poshmark",
          externalUrl: "https://poshmark.com/listing/abc",
        }),
      ],
      syncJobs: [
        {
          id: "j-1",
          userId: "user-1",
          type: "delist_marketplace_listing",
          status: "queued",
          inventoryItemId: "item-1",
          marketplaceListingId: "l-posh",
          payload: {
            inventoryItemId: "item-1",
            marketplaceListingId: "l-posh",
            marketplace: "poshmark",
            soldMarketplace: "ebay",
          },
        },
      ],
    });
    const db = workerDb(prisma);
    const ebayDelist = vi.fn();

    const summary = await runQueuedSyncJobs(db, { limit: 10 }, { ebayDelist });

    expect(summary).toMatchObject({ claimed: 1, needsReview: 1 });
    expect(ebayDelist).not.toHaveBeenCalled();
    // No fake delist: the Poshmark listing is not ended.
    expect(prisma._store.listings[0].endedAt).toBeNull();
    const task = prisma._store.reviewTasks.find((t) => t.type === "manual_delist_required");
    expect(task?.marketplace).toBe("poshmark");
  });
});

describe("runSyncJob — notify_user", () => {
  function notifySeed(payload: unknown) {
    return {
      id: "j-1",
      userId: "user-1",
      type: "notify_user" as const,
      status: "queued" as const,
      inventoryItemId: "item-1",
      payload,
    };
  }

  it("creates a notification + notification_sent event once", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      syncJobs: [
        notifySeed({
          kind: "sold_delisting",
          title: "Sold",
          body: "Your item sold.",
          inventoryItemId: "item-1",
        }),
      ],
    });
    const db = workerDb(prisma);

    const summary = await runQueuedSyncJobs(db, { limit: 10 });

    expect(summary).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(prisma._store.notifications).toHaveLength(1);
    expect(prisma._store.events.some((e) => e.type === "notification_sent")).toBe(true);
  });

  it("a duplicate notify job does not duplicate the notification", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      syncJobs: [
        notifySeed({
          kind: "sold_delisting",
          title: "Sold",
          body: "Your item sold.",
          inventoryItemId: "item-1",
        }),
        {
          ...notifySeed({
            kind: "sold_delisting",
            title: "Sold",
            body: "Your item sold.",
            inventoryItemId: "item-1",
          }),
          id: "j-2",
          idempotencyKey: "idem-j-2",
        },
      ],
    });
    const db = workerDb(prisma);

    await runQueuedSyncJobs(db, { limit: 10 });

    expect(prisma._store.notifications).toHaveLength(1);
  });

  it("invalid payload (missing fields) -> job failed with sanitized message", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      syncJobs: [notifySeed({ kind: "sold_delisting" })],
    });
    const db = workerDb(prisma);

    const summary = await runQueuedSyncJobs(db, { limit: 10 });

    expect(summary).toMatchObject({ claimed: 1, failed: 1 });
    expect(prisma._store.syncJobs[0].status).toBe("failed");
    expect(prisma._store.notifications).toHaveLength(0);
  });
});

describe("runSyncJob — create_review_task", () => {
  function reviewSeed(id: string) {
    return {
      id,
      userId: "user-1",
      type: "create_review_task" as const,
      status: "queued" as const,
      inventoryItemId: "item-1",
      idempotencyKey: `idem-${id}`,
      payload: {
        type: "manual_delist_required",
        inventoryItemId: "item-1",
        marketplace: "poshmark",
        title: "Remove listing",
        description: "Please remove your listing.",
      },
    };
  }

  it("creates the review task once", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      syncJobs: [reviewSeed("j-1")],
    });
    const db = workerDb(prisma);

    const summary = await runQueuedSyncJobs(db, { limit: 10 });

    expect(summary).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(prisma._store.reviewTasks).toHaveLength(1);
  });

  it("a duplicate create_review_task job does not duplicate the open task", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      syncJobs: [reviewSeed("j-1"), reviewSeed("j-2")],
    });
    const db = workerDb(prisma);

    await runQueuedSyncJobs(db, { limit: 10 });

    expect(prisma._store.reviewTasks).toHaveLength(1);
    expect(prisma._store.syncJobs.every((j) => j.status === "succeeded")).toBe(true);
  });
});

describe("runSyncJob — fail-closed executors", () => {
  it.each([
    "mark_sold",
    "update_inventory_quantity",
    "update_price",
    "sync_order",
  ] as const)("%s is skipped with NOT_IMPLEMENTED (never silently succeeds)", async (type) => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      syncJobs: [{ id: "j-1", userId: "user-1", type, status: "queued" }],
    });
    const db = workerDb(prisma);

    const summary = await runQueuedSyncJobs(db, { limit: 10 });

    expect(summary).toMatchObject({ claimed: 1, skipped: 1 });
    const job = prisma._store.syncJobs[0];
    expect(job.status).toBe("skipped");
    expect(job.errorCode).toBe("NOT_IMPLEMENTED");
  });

  it("detect_status remains fail-closed for marketplaces without a status executor", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      listings: [listing({ id: "l-ebay", marketplace: "ebay", externalListingId: "e1" })],
      syncJobs: [
        {
          id: "j-1",
          userId: "user-1",
          type: "detect_status",
          status: "queued",
          inventoryItemId: "item-1",
          marketplaceListingId: "l-ebay",
          payload: {
            inventoryItemId: "item-1",
            marketplaceListingId: "l-ebay",
          },
        },
      ],
    });
    const db = workerDb(prisma);

    const summary = await runQueuedSyncJobs(db, { limit: 10 });

    expect(summary).toMatchObject({ claimed: 1, skipped: 1 });
    const job = prisma._store.syncJobs[0];
    expect(job.status).toBe("skipped");
    expect(job.errorCode).toBe("NOT_IMPLEMENTED");
  });
});

describe("runSyncJob — detect_status (StockX)", () => {
  function stockxStatusJobSeed() {
    return {
      id: "j-1",
      userId: "user-1",
      type: "detect_status" as const,
      status: "queued" as const,
      inventoryItemId: "item-1",
      marketplaceListingId: "l-stockx",
      payload: {
        inventoryItemId: "item-1",
        marketplaceListingId: "l-stockx",
        marketplace: "stockx",
        accountId: "account-1",
      },
    };
  }

  it("runs the StockX status sync adapter and succeeds", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item({ accountId: "account-1" })],
      listings: [
        listing({
          id: "l-stockx",
          marketplace: "stockx",
          status: "LISTING",
          externalListingId: "stockx-listing-1",
        }),
      ],
      syncJobs: [stockxStatusJobSeed()],
    });
    const db = workerDb(prisma);
    const stockxStatusSync = vi.fn().mockResolvedValue({
      status: "active",
      listingId: "stockx-listing-1",
    });

    const summary = await runQueuedSyncJobs(db, { limit: 10 }, { stockxStatusSync });

    expect(summary).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(stockxStatusSync).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        userId: "user-1",
        accountId: "account-1",
        inventoryItemId: "item-1",
        marketplaceListingId: "l-stockx",
      }),
    );
    expect(prisma._store.syncJobs[0].status).toBe("succeeded");
  });

  it("runs StockX status sync jobs scoped to a shared account", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item({ sellerId: "owner-1", accountId: "account-1" })],
      listings: [
        listing({
          id: "l-stockx",
          marketplace: "stockx",
          status: "LISTING",
          externalListingId: "stockx-listing-1",
        }),
      ],
      syncJobs: [
        {
          ...stockxStatusJobSeed(),
          userId: "member-1",
          payload: {
            inventoryItemId: "item-1",
            marketplaceListingId: "l-stockx",
            marketplace: "stockx",
            accountId: "account-1",
          },
        },
      ],
    });
    const db = workerDb(prisma);
    const stockxStatusSync = vi.fn().mockResolvedValue({
      status: "active",
      listingId: "stockx-listing-1",
    });

    const summary = await runQueuedSyncJobs(db, { limit: 10 }, { stockxStatusSync });

    expect(summary).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(stockxStatusSync).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        userId: "member-1",
        accountId: "account-1",
        inventoryItemId: "item-1",
        marketplaceListingId: "l-stockx",
      }),
    );
  });

  it("persists only sanitized StockX status-sync failures", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item({ accountId: "account-1" })],
      listings: [
        listing({
          id: "l-stockx",
          marketplace: "stockx",
          status: "LISTING",
          externalListingId: "stockx-listing-1",
        }),
      ],
      syncJobs: [stockxStatusJobSeed()],
    });
    const db = workerDb(prisma);
    const stockxStatusSync = vi.fn().mockRejectedValue(
      new Error("provider secret Bearer abc.def at /app/src/token.ts:1"),
    );

    const summary = await runQueuedSyncJobs(db, { limit: 10 }, { stockxStatusSync });

    expect(summary).toMatchObject({ claimed: 1, failed: 1 });
    const job = prisma._store.syncJobs[0];
    expect(job.status).toBe("failed");
    expect(job.errorCode).toBe("STATUS_SYNC_FAILED");
    expect(job.errorMessage).not.toContain("Bearer");
    expect(job.errorMessage).not.toContain("secret");
    const event = prisma._store.events.find((entry) => entry.type === "sync_conflict");
    expect(JSON.stringify(event?.payload)).not.toContain("Bearer");
  });
});

describe("runSyncJob — idempotent no-op", () => {
  it("a job not in a runnable (running) state is a no-op", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      syncJobs: [
        { id: "j-1", userId: "user-1", type: "notify_user", status: "succeeded" },
      ],
    });
    const db = workerDb(prisma);

    const result = await runSyncJob(db, "j-1");
    expect(result.status).toBe("succeeded");
    // Untouched.
    expect(prisma._store.notifications).toHaveLength(0);
  });
});

describe("requeueStaleRunningSyncJobs", () => {
  const HOUR_AGO = () => new Date(Date.now() - 60 * 60_000);
  const NOW = () => new Date();

  it("requeues a stale running job (status=queued, runAfter set, attempts UNCHANGED)", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      syncJobs: [
        {
          id: "j-stale",
          userId: "user-1",
          type: "notify_user",
          status: "running",
          attempts: 2,
          maxAttempts: 5,
          updatedAt: HOUR_AGO(),
        },
      ],
    });
    const db = workerDb(prisma);

    const summary = await requeueStaleRunningSyncJobs(db, {
      olderThanMinutes: 15,
      limit: 10,
    });

    expect(summary).toEqual({ requeued: 1, failed: 0 });
    const job = prisma._store.syncJobs.find((j) => j.id === "j-stale");
    expect(job?.status).toBe("queued");
    expect(job?.runAfter).toBeInstanceOf(Date);
    // attempts is NOT reset (the claim already counted it).
    expect(job?.attempts).toBe(2);
  });

  it("leaves a FRESH running job (updatedAt within threshold) untouched", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      syncJobs: [
        {
          id: "j-fresh",
          userId: "user-1",
          type: "notify_user",
          status: "running",
          attempts: 1,
          maxAttempts: 5,
          updatedAt: NOW(),
        },
      ],
    });
    const db = workerDb(prisma);

    const summary = await requeueStaleRunningSyncJobs(db, {
      olderThanMinutes: 15,
      limit: 10,
    });

    expect(summary).toEqual({ requeued: 0, failed: 0 });
    const job = prisma._store.syncJobs.find((j) => j.id === "j-fresh");
    expect(job?.status).toBe("running");
  });

  it("fails (terminal) a stale running job at attempts >= maxAttempts (not requeued)", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      syncJobs: [
        {
          id: "j-exhausted",
          userId: "user-1",
          type: "notify_user",
          status: "running",
          attempts: 5,
          maxAttempts: 5,
          updatedAt: HOUR_AGO(),
        },
      ],
    });
    const db = workerDb(prisma);

    const summary = await requeueStaleRunningSyncJobs(db, {
      olderThanMinutes: 15,
      limit: 10,
    });

    expect(summary).toEqual({ requeued: 0, failed: 1 });
    const job = prisma._store.syncJobs.find((j) => j.id === "j-exhausted");
    expect(job?.status).toBe("failed");
    expect(job?.errorCode).toBe("MAX_ATTEMPTS_EXHAUSTED");
    // Sanitized, generic copy — never raw internals.
    expect(job?.errorMessage).toBe("The job exceeded its maximum attempts.");
  });

  it("respects the limit (only `limit` stale rows are touched)", async () => {
    const stale = Array.from({ length: 8 }, (_, i) => ({
      id: `j-${i}`,
      userId: "user-1",
      type: "notify_user" as const,
      status: "running" as const,
      attempts: 1,
      maxAttempts: 5,
      updatedAt: HOUR_AGO(),
    }));
    const prisma = createInventoryFakePrisma({ items: [item()], syncJobs: stale });
    const db = workerDb(prisma);

    const summary = await requeueStaleRunningSyncJobs(db, {
      olderThanMinutes: 15,
      limit: 3,
    });

    expect(summary.requeued).toBe(3);
    const requeued = prisma._store.syncJobs.filter((j) => j.status === "queued");
    expect(requeued).toHaveLength(3);
    // The rest stay running, untouched.
    expect(prisma._store.syncJobs.filter((j) => j.status === "running")).toHaveLength(5);
  });

  it("clamps a too-small olderThanMinutes up to the safe minimum (>=5)", async () => {
    // A job last updated 6 minutes ago: stale only if the window is clamped to a
    // minimum of 5 (not the 1 the caller asked for, which would NOT match it... it
    // would match either way; the real risk is a 0/negative window catching a
    // truly fresh job). Here a 2-minute-old job must NOT be requeued when caller
    // passes minutes=0, proving the window was clamped to >=5.
    const prisma = createInventoryFakePrisma({
      items: [item()],
      syncJobs: [
        {
          id: "j-recent",
          userId: "user-1",
          type: "notify_user",
          status: "running",
          attempts: 1,
          maxAttempts: 5,
          updatedAt: new Date(Date.now() - 2 * 60_000),
        },
      ],
    });
    const db = workerDb(prisma);

    const summary = await requeueStaleRunningSyncJobs(db, {
      olderThanMinutes: 0,
      limit: 10,
    });

    // Clamped to >=5 min, so a 2-min-old running job is NOT stale yet.
    expect(summary).toEqual({ requeued: 0, failed: 0 });
    expect(prisma._store.syncJobs[0].status).toBe("running");
  });

  it("creates NO review tasks, events, or notifications (status change only)", async () => {
    const prisma = createInventoryFakePrisma({
      items: [item()],
      syncJobs: [
        {
          id: "j-stale",
          userId: "user-1",
          type: "delist_marketplace_listing",
          status: "running",
          attempts: 5,
          maxAttempts: 5,
          inventoryItemId: "item-1",
          updatedAt: HOUR_AGO(),
        },
        {
          id: "j-stale-2",
          userId: "user-1",
          type: "notify_user",
          status: "running",
          attempts: 1,
          maxAttempts: 5,
          inventoryItemId: "item-1",
          updatedAt: HOUR_AGO(),
        },
      ],
    });
    const db = workerDb(prisma);

    await requeueStaleRunningSyncJobs(db, { olderThanMinutes: 15, limit: 10 });

    expect(prisma._store.reviewTasks).toHaveLength(0);
    expect(prisma._store.events).toHaveLength(0);
    expect(prisma._store.notifications).toHaveLength(0);
  });
});
