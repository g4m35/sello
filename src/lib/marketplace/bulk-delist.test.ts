import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  executeBulkEbayDelist,
  executeBulkStockXDelist,
  preflightBulkEbayDelist,
  preflightBulkStockXDelist,
  type BulkDelistDeps,
  type BulkDelistItemResult,
  type DelistPreflightStatus,
} from "./bulk-delist";

const config = { maxItemsPerRequest: 1000, chunkSize: 20, concurrency: 2 };

function preflightDeps(byId: Record<string, DelistPreflightStatus>): BulkDelistDeps {
  return {
    config,
    async preflightItem({ itemId }) {
      return { status: byId[itemId] ?? "rejected" };
    },
    async executeItem() {
      throw new Error("not used");
    },
  };
}

function executeDeps(byId: Record<string, BulkDelistItemResult["status"]>): BulkDelistDeps {
  return {
    config,
    async preflightItem() {
      return { status: "eligible" };
    },
    async executeItem({ itemId }) {
      const status = byId[itemId] ?? "failed";
      return { itemId, status, message: status, retrySafe: status === "failed" };
    },
  };
}

const prisma = {} as never;

describe("preflightBulkEbayDelist", () => {
  it("classifies and counts each selected item, with alpha copy when not allowed", async () => {
    const result = await preflightBulkEbayDelist(
      prisma,
      {
        userId: "u1",
        itemIds: ["a", "b", "c", "d", "e"],
        liveDelistAllowed: false,
      },
      preflightDeps({
        a: "eligible",
        b: "eligible",
        c: "already_ended",
        d: "not_listed",
        e: "in_flight",
      }),
    );

    expect(result.total).toBe(5);
    expect(result.eligibleCount).toBe(2);
    expect(result.alreadyEndedCount).toBe(1);
    expect(result.notListedCount).toBe(1);
    expect(result.inFlightCount).toBe(1);
    expect(result.liveDelistAllowed).toBe(false);
    expect(result.alphaCopy).toBeTruthy();
  });

  it("dedupes selected ids", async () => {
    const result = await preflightBulkEbayDelist(
      prisma,
      { userId: "u1", itemIds: ["a", "a", "b"], liveDelistAllowed: true },
      preflightDeps({ a: "eligible", b: "eligible" }),
    );
    expect(result.total).toBe(2);
    expect(result.alphaCopy).toBeUndefined();
  });
});

describe("executeBulkEbayDelist", () => {
  it("aggregates ended/skipped/failed per-item results under one bulk run", async () => {
    const result = await executeBulkEbayDelist(
      prisma,
      { userId: "u1", itemIds: ["a", "b", "c"], bulkRunId: "run-1" },
      executeDeps({ a: "ended", b: "skipped", c: "failed" }),
    );

    expect(result.bulkRunId).toBe("run-1");
    expect(result.endedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.items.find((i) => i.itemId === "c")?.retrySafe).toBe(true);
  });

  it("isolates a thrown item as a safe retryable failure, not a whole-run abort", async () => {
    const deps: BulkDelistDeps = {
      config,
      async preflightItem() {
        return { status: "eligible" };
      },
      async executeItem({ itemId }) {
        if (itemId === "boom") throw new Error("unexpected");
        return { itemId, status: "ended", message: "Ended on eBay." };
      },
    };
    const result = await executeBulkEbayDelist(
      prisma,
      { userId: "u1", itemIds: ["ok", "boom"], bulkRunId: "run-2" },
      deps,
    );
    expect(result.endedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.items.find((i) => i.itemId === "boom")?.retrySafe).toBe(true);
  });
});

describe("preflightBulkStockXDelist", () => {
  it("classifies StockX delist eligibility without marketplace mutation", async () => {
    const result = await preflightBulkStockXDelist(
      prisma,
      { userId: "u1", accountId: "acc-1", itemIds: ["a", "b", "c"] },
      preflightDeps({
        a: "eligible",
        b: "already_ended",
        c: "not_listed",
      }),
    );

    expect(result.liveDelistAllowed).toBe(true);
    expect(result.eligibleCount).toBe(1);
    expect(result.alreadyEndedCount).toBe(1);
    expect(result.notListedCount).toBe(1);
  });
});

describe("executeBulkStockXDelist", () => {
  it("aggregates StockX ended/skipped/failed results under one bulk run", async () => {
    const result = await executeBulkStockXDelist(
      prisma,
      { userId: "u1", accountId: "acc-1", itemIds: ["a", "b", "c"], bulkRunId: "run-stockx" },
      executeDeps({ a: "ended", b: "skipped", c: "failed" }),
    );

    expect(result.bulkRunId).toBe("run-stockx");
    expect(result.endedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.failedCount).toBe(1);
  });
});
