import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  executeBulkEbayPublish,
  executeBulkStockXPublish,
  preflightBulkEbayPublish,
  preflightBulkStockXPublish,
  type BulkItemResult,
  type BulkPublishDeps,
  type ItemPreflightOutcome,
} from "./bulk-publish";

function u(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
}

const config = { maxItemsPerRequest: 1000, chunkSize: 10, concurrency: 2 };

function deps(over: Partial<BulkPublishDeps> = {}): BulkPublishDeps {
  return {
    config,
    preflightItem: vi.fn(async (): Promise<ItemPreflightOutcome> => ({ status: "ready" })),
    executeItem: vi.fn(
      async ({ itemId }): Promise<BulkItemResult> => ({
        itemId,
        status: "published",
        message: "Listed on eBay.",
        externalListingId: "1100" + itemId.slice(-4),
      }),
    ),
    ...over,
  };
}

describe("preflightBulkEbayPublish", () => {
  it("preflights every selected id and tallies ready/needs_details/skipped/rejected", async () => {
    const map: Record<string, ItemPreflightOutcome> = {
      [u(1)]: { status: "ready" },
      [u(2)]: { status: "needs_details", missing: ["Title", "Price"] },
      [u(3)]: { status: "skipped" },
      [u(4)]: { status: "rejected" },
    };
    const d = deps({ preflightItem: vi.fn(async ({ itemId }) => map[itemId]) });

    const res = await preflightBulkEbayPublish(
      {} as never,
      { userId: "user-1", itemIds: [u(1), u(2), u(3), u(4)], livePublishAllowed: true },
      d,
    );

    expect(res.total).toBe(4);
    expect(res.readyCount).toBe(1);
    expect(res.needsDetailsCount).toBe(1);
    expect(res.skippedCount).toBe(1);
    expect(res.rejectedCount).toBe(1);
    expect(res.items.find((i) => i.itemId === u(2))?.missing).toEqual(["Title", "Price"]);
    expect(res.livePublishAllowed).toBe(true);
    expect(res.alphaCopy).toBeUndefined();
  });

  it("returns ready 2 / blocked 1 with a clear reason for a 2-ready + 1-blocked selection", async () => {
    const map: Record<string, ItemPreflightOutcome> = {
      [u(1)]: { status: "ready" },
      [u(2)]: { status: "ready" },
      [u(3)]: { status: "needs_details", missing: ["Photos"] },
    };
    const res = await preflightBulkEbayPublish(
      {} as never,
      { userId: "user-1", itemIds: [u(1), u(2), u(3)], livePublishAllowed: true },
      deps({ preflightItem: vi.fn(async ({ itemId }) => map[itemId]) }),
    );

    expect(res.readyCount).toBe(2);
    expect(res.needsDetailsCount).toBe(1);
    expect(res.items.find((i) => i.itemId === u(3))).toMatchObject({
      status: "needs_details",
      missing: ["Photos"],
    });
  });

  it("is available to non-allowlisted users with alpha copy and no live action", async () => {
    const res = await preflightBulkEbayPublish(
      {} as never,
      { userId: "user-1", itemIds: [u(1)], livePublishAllowed: false },
      deps(),
    );
    expect(res.livePublishAllowed).toBe(false);
    expect(res.alphaCopy).toMatch(/alpha accounts/i);
  });

  it("dedupes selected ids before preflighting", async () => {
    const preflightItem = vi.fn(async (): Promise<ItemPreflightOutcome> => ({ status: "ready" }));
    const res = await preflightBulkEbayPublish(
      {} as never,
      { userId: "user-1", itemIds: [u(1), u(1), u(2)], livePublishAllowed: true },
      deps({ preflightItem }),
    );
    expect(res.total).toBe(2);
    expect(preflightItem).toHaveBeenCalledTimes(2);
  });

  it("never exceeds configured concurrency across many items", async () => {
    let inFlight = 0;
    let peak = 0;
    const preflightItem = vi.fn(async (): Promise<ItemPreflightOutcome> => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return { status: "ready" };
    });
    await preflightBulkEbayPublish(
      {} as never,
      { userId: "user-1", itemIds: Array.from({ length: 25 }, (_, i) => u(i + 1)), livePublishAllowed: true },
      deps({ preflightItem }),
    );
    expect(peak).toBeLessThanOrEqual(2);
  });
});

describe("executeBulkEbayPublish", () => {
  it("publishes 25 items across chunks with one shared bulkRunId", async () => {
    const seenRunIds = new Set<string>();
    const executeItem = vi.fn(async ({ itemId, bulkRunId }): Promise<BulkItemResult> => {
      seenRunIds.add(bulkRunId);
      return { itemId, status: "published", message: "Listed on eBay." };
    });
    const ids = Array.from({ length: 25 }, (_, i) => u(i + 1));

    const res = await executeBulkEbayPublish(
      {} as never,
      { userId: "user-1", itemIds: ids, bulkRunId: u(999) },
      deps({ executeItem }),
    );

    expect(res.total).toBe(25);
    expect(res.publishedCount).toBe(25);
    expect(res.items.map((i) => i.itemId)).toEqual(ids);
    expect([...seenRunIds]).toEqual([u(999)]);
  });

  it("dedupes selected ids before executing", async () => {
    const executeItem = vi.fn(
      async ({ itemId }): Promise<BulkItemResult> => ({
        itemId,
        status: "published",
        message: "Listed on eBay.",
      }),
    );
    const res = await executeBulkEbayPublish(
      {} as never,
      { userId: "user-1", itemIds: [u(1), u(1), u(2)], bulkRunId: u(999) },
      deps({ executeItem }),
    );

    expect(res.total).toBe(2);
    expect(executeItem).toHaveBeenCalledTimes(2);
  });

  it("returns stable per-item outcomes and counts for a mixed run", async () => {
    const map: Record<string, BulkItemResult> = {
      [u(1)]: { itemId: u(1), status: "published", message: "Listed on eBay." },
      [u(2)]: { itemId: u(2), status: "skipped", message: "This item is already listed on eBay." },
      [u(3)]: { itemId: u(3), status: "needs_details", message: "Needs details." },
    };
    const res = await executeBulkEbayPublish(
      {} as never,
      { userId: "user-1", itemIds: [u(1), u(2), u(3)], bulkRunId: u(999) },
      deps({ executeItem: vi.fn(async ({ itemId }) => map[itemId]) }),
    );

    expect(res.publishedCount).toBe(1);
    expect(res.skippedCount).toBe(1);
    expect(res.needsDetailsCount).toBe(1);
    expect(res.failedCount).toBe(0);
    expect(res.items.map((i) => i.status)).toEqual(["published", "skipped", "needs_details"]);
  });

  it("isolates a thrown error into a stable failed result without stopping others", async () => {
    const executeItem = vi.fn(async ({ itemId }): Promise<BulkItemResult> => {
      if (itemId === u(2)) throw new Error("DB token=secret-xyz exploded");
      return { itemId, status: "published", message: "Listed on eBay." };
    });
    const res = await executeBulkEbayPublish(
      {} as never,
      { userId: "user-1", itemIds: [u(1), u(2), u(3)], bulkRunId: u(999) },
      deps({ executeItem }),
    );

    expect(res.publishedCount).toBe(2);
    expect(res.failedCount).toBe(1);
    const failed = res.items.find((i) => i.itemId === u(2));
    expect(failed?.status).toBe("failed");
    expect(JSON.stringify(res)).not.toContain("secret-xyz");
  });
});

describe("preflightBulkStockXPublish", () => {
  it("preflights every selected id and returns StockX-ready counts", async () => {
    const map: Record<string, ItemPreflightOutcome> = {
      [u(1)]: { status: "ready" },
      [u(2)]: { status: "needs_details", missing: ["Exact StockX size/variant"] },
      [u(3)]: { status: "skipped", missing: ["Existing StockX listing"] },
    };
    const preflightItem = vi.fn(async ({ itemId }) => map[itemId]);

    const res = await preflightBulkStockXPublish(
      {} as never,
      { userId: "seller-1", accountId: "acc-1", itemIds: [u(1), u(2), u(3)] },
      deps({ preflightItem }),
    );

    expect(res.livePublishAllowed).toBe(true);
    expect(res.readyCount).toBe(1);
    expect(res.needsDetailsCount).toBe(1);
    expect(res.skippedCount).toBe(1);
    expect(preflightItem).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "seller-1", accountId: "acc-1", itemId: u(1) }),
    );
  });
});

describe("executeBulkStockXPublish", () => {
  it("blocks the whole batch when server-side preflight finds any blocked item", async () => {
    const executeItem = vi.fn();
    const map: Record<string, ItemPreflightOutcome> = {
      [u(1)]: { status: "ready" },
      [u(2)]: { status: "needs_details", missing: ["Exact StockX product"] },
    };

    await expect(
      executeBulkStockXPublish(
        {} as never,
        { userId: "seller-1", accountId: "acc-1", itemIds: [u(1), u(2)], bulkRunId: u(999) },
        deps({
          preflightItem: vi.fn(async ({ itemId }) => map[itemId]),
          executeItem,
        }),
      ),
    ).rejects.toMatchObject({ status: 400, code: "BULK_STOCKX_PREFLIGHT_BLOCKED" });

    expect(executeItem).not.toHaveBeenCalled();
  });

  it("re-runs preflight, then executes ready StockX items with one shared bulkRunId", async () => {
    const preflightItem = vi.fn(async (): Promise<ItemPreflightOutcome> => ({ status: "ready" }));
    const executeItem = vi.fn(async ({ itemId }): Promise<BulkItemResult> => ({
      itemId,
      status: "published",
      message: "Submitted to StockX. Sello is checking status.",
      externalListingId: `sx-${itemId.slice(-4)}`,
    }));

    const res = await executeBulkStockXPublish(
      {} as never,
      { userId: "seller-1", accountId: "acc-1", itemIds: [u(1), u(2)], bulkRunId: u(999) },
      deps({ preflightItem, executeItem }),
    );

    expect(preflightItem).toHaveBeenCalledTimes(2);
    expect(executeItem).toHaveBeenCalledTimes(2);
    expect(executeItem).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: "acc-1", bulkRunId: u(999), itemId: u(1) }),
    );
    expect(res.publishedCount).toBe(2);
  });
});
