import { describe, expect, it, vi } from "vitest";
import { recoverChangedEtsyPublish } from "./publish-recovery";
const input = { user: { id: "user" }, accountId: "account", itemId: "item", marketplaceListingId: "listing", usageKey: "attempt" };
describe("Etsy publish conflict recovery", () => {
  it("enqueues one distinct recovery action across concurrent retries", async () => {
    const jobs = new Map<string, unknown>();
    const oldJob = { id: "old", status: "needs_review" }; jobs.set("delist:item:listing", oldJob);
    const db = { inventoryItem: { findFirst: vi.fn().mockResolvedValue({ soldSourceMarketplace: "ebay" }) }, syncJob: { upsert: vi.fn(async ({ where, create }) => {
      if (!jobs.has(where.idempotencyKey)) jobs.set(where.idempotencyKey, { id: "new", ...create });
      return jobs.get(where.idempotencyKey);
    }) } };
    const results = await Promise.all([recoverChangedEtsyPublish(input, db as never), recoverChangedEtsyPublish(input, db as never)]);
    expect(results[0]).toBe(results[1]); expect(jobs.size).toBe(2);
    expect(results[0]).toMatchObject({ status: "queued", idempotencyKey: "etsy-publish-recovery:listing:attempt", payload: { soldMarketplace: "ebay" } });
    expect(oldJob.status).toBe("needs_review");
  });
  it.each([null, { soldSourceMarketplace: "etsy" }])("does not queue removal for a foreign item or Etsy sale source", async (item) => {
    const db = { inventoryItem: { findFirst: vi.fn().mockResolvedValue(item) }, syncJob: { upsert: vi.fn() } };
    expect(await recoverChangedEtsyPublish(input, db as never)).toBeNull();
    expect(db.syncJob.upsert).not.toHaveBeenCalled();
  });
});
