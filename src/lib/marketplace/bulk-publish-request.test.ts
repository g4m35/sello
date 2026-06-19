import { describe, expect, it } from "vitest";

import {
  BulkPublishExecuteRequestSchema,
  BulkPublishPreflightRequestSchema,
  loadBulkPublishConfig,
  processInChunks,
  uniqueItemIds,
} from "./bulk-publish-request";

// Valid v4-shaped UUIDs, deterministic by index.
function u(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
}
function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => u(i + 1));
}

describe("uniqueItemIds", () => {
  it("dedupes while preserving first-seen order", () => {
    expect(uniqueItemIds([u(1), u(2), u(1), u(3), u(2)])).toEqual([u(1), u(2), u(3)]);
  });
});

describe("BulkPublishPreflightRequestSchema", () => {
  it("dedupes ids and requires at least one", () => {
    expect(BulkPublishPreflightRequestSchema.parse({ itemIds: [u(1), u(1), u(2)] })).toMatchObject({
      itemIds: [u(1), u(2)],
    });
    expect(BulkPublishPreflightRequestSchema.safeParse({ itemIds: [] }).success).toBe(false);
  });

  it("rejects non-uuid ids and a malformed bulkRunId", () => {
    expect(BulkPublishPreflightRequestSchema.safeParse({ itemIds: ["nope"] }).success).toBe(false);
    expect(
      BulkPublishPreflightRequestSchema.safeParse({ itemIds: [u(1)], bulkRunId: "nope" }).success,
    ).toBe(false);
    expect(
      BulkPublishPreflightRequestSchema.safeParse({ itemIds: [u(1)], bulkRunId: u(9) }).success,
    ).toBe(true);
  });

  it("accepts large selections — no low product cap (11, 50, 250)", () => {
    for (const n of [11, 50, 250]) {
      const parsed = BulkPublishPreflightRequestSchema.parse({ itemIds: ids(n) });
      expect(parsed.itemIds).toHaveLength(n);
    }
  });
});

describe("BulkPublishExecuteRequestSchema", () => {
  it("requires explicit confirmLivePublish: true", () => {
    expect(BulkPublishExecuteRequestSchema.safeParse({ itemIds: [u(1)] }).success).toBe(false);
    expect(
      BulkPublishExecuteRequestSchema.safeParse({ itemIds: [u(1)], confirmLivePublish: false }).success,
    ).toBe(false);
    expect(
      BulkPublishExecuteRequestSchema.safeParse({ itemIds: [u(1)], confirmLivePublish: true }).success,
    ).toBe(true);
  });
});

describe("loadBulkPublishConfig", () => {
  it("uses safe defaults", () => {
    expect(loadBulkPublishConfig({})).toEqual({
      maxItemsPerRequest: 1000,
      chunkSize: 20,
      concurrency: 2,
    });
  });

  it("honors a high configurable transport ceiling and clamps concurrency 1..3", () => {
    expect(loadBulkPublishConfig({ BULK_PUBLISH_MAX_ITEMS: "5000" }).maxItemsPerRequest).toBe(5000);
    expect(loadBulkPublishConfig({ BULK_PUBLISH_CONCURRENCY: "9" }).concurrency).toBe(3);
    expect(loadBulkPublishConfig({ BULK_PUBLISH_CONCURRENCY: "0" }).concurrency).toBe(1);
    expect(loadBulkPublishConfig({ BULK_PUBLISH_CHUNK_SIZE: "50" }).chunkSize).toBe(50);
  });
});

describe("processInChunks", () => {
  it("preserves input order in the results", async () => {
    const out = await processInChunks(
      [1, 2, 3, 4, 5],
      { chunkSize: 2, concurrency: 2 },
      async (n) => n * 10,
    );
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it("never runs more than the configured concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    await processInChunks(ids(25), { chunkSize: 10, concurrency: 2 }, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight -= 1;
      return true;
    });
    expect(peak).toBeLessThanOrEqual(2);
  });
});
