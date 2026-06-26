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
    "detect_status",
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
