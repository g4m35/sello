import { describe, expect, it } from "vitest";

import { assertBulkItemTransition, summarizeBulkItems } from "./status";

describe("bulk intake status contract", () => {
  it("allows only explicit item transitions", () => {
    expect(() => assertBulkItemTransition("uploaded", "grouping")).not.toThrow();
    expect(() => assertBulkItemTransition("grouping", "ready_for_generation")).not.toThrow();
    expect(() => assertBulkItemTransition("ready_for_generation", "generating")).not.toThrow();
    expect(() => assertBulkItemTransition("generating", "listing_ready")).not.toThrow();
    expect(() => assertBulkItemTransition("listing_ready", "generating")).toThrowError(
      expect.objectContaining({ code: "BULK_ITEM_INVALID_TRANSITION" }),
    );
  });

  it("derives ready, needs-review, failed, canceled, and partial-failure batches", () => {
    expect(summarizeBulkItems([{ status: "listing_ready" }]).status).toBe("ready");
    expect(summarizeBulkItems([{ status: "ready_for_generation" }]).status).toBe(
      "needs_review",
    );
    expect(summarizeBulkItems([{ status: "failed" }]).status).toBe("failed");
    expect(summarizeBulkItems([{ status: "canceled" }]).status).toBe("canceled");
    expect(
      summarizeBulkItems([{ status: "listing_ready" }, { status: "failed" }]),
    ).toMatchObject({
      status: "partially_failed",
      totalItems: 2,
      processedItems: 2,
      listingReadyItems: 1,
      failedItems: 1,
    });
  });

  it("keeps an in-flight mixed batch processing", () => {
    expect(
      summarizeBulkItems([{ status: "listing_ready" }, { status: "generating" }]),
    ).toMatchObject({ status: "processing", processedItems: 1 });
  });
});
