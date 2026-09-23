import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { automationJobData, runListingJob, runListingQueue } from "./listing-job";

function harness() {
  const now = new Date();
  const job = { ...automationJobData({ id: "job", inventoryItemId: "item", accountId: "account", userId: "user", warnings: [], policy: { mode: "publish", marketplace: "ebay", consent: true, minPriceCents: 10000, maxPriceCents: 20000 } }), updatedAt: now };
  const item = { id: "item", accountId: "account", sellerId: "user", confidence: 0.98, status: "DRAFT_READY", quantityAvailable: 1, updatedAt: now, listingDrafts: [{ id: "draft", marketplaceDrafts: { ebay: { quantity: 1 } }, updatedAt: now, recommendedPriceCents: 15000 }] };
  const db = {
    jobLog: {
      findFirst: vi.fn(async () => structuredClone(job)),
      findMany: vi.fn(async () => [] as typeof job[]),
      updateMany: vi.fn(async ({ where, data }) => {
        if (where.status !== job.status) return { count: 0 };
        Object.assign(job, data); return { count: 1 };
      }),
    },
    inventoryItem: { findFirst: vi.fn(async () => structuredClone(item)), updateMany: vi.fn(async () => ({ count: 1 })) },
    listingDraft: { updateMany: vi.fn(async () => ({ count: 1 })) },
    reviewTask: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: "review" })) },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (fn) => fn(db));
  const deps = {
    resolveUser: vi.fn(async () => ({ id: "user" })),
    entitlements: vi.fn(async () => ({ account: { id: "account" }, access: { paidComps: true } })),
    fetchComps: vi.fn(async () => ({ summary: { recommendedListCents: 15000, confidence: "high", soldCompCount: 10, pricingBasis: "sold_comps" } })),
    publish: vi.fn(async () => ({ outcome: { status: "published" } })),
  };
  const run = () => runListingJob("job", db as never, deps as never);
  return { job, item, db, deps, run };
}

describe("durable automatic listing jobs", () => {
  beforeEach(() => vi.restoreAllMocks());
  it("claims concurrent runs once and uses guarded publishing with stable quota key", async () => {
    const h = harness();
    await Promise.all([h.run(), h.run()]);
    expect(h.deps.fetchComps).toHaveBeenCalledTimes(1);
    expect(h.deps.publish).toHaveBeenCalledTimes(1);
    expect(h.deps.publish).toHaveBeenCalledWith({ id: "user" }, { inventoryItemId: "item", marketplace: "ebay" }, "job:publish:ebay", "account", expect.objectContaining({ priceCents: 15000 }));
    expect(h.job.status).toBe("SUCCEEDED");
  });
  it("prepares without any publication when consent is prepare-only", async () => {
    const h = harness(); (h.job.payload as Record<string, unknown>).policy = { mode: "prepare" };
    await h.run(); expect(h.deps.publish).not.toHaveBeenCalled(); expect(h.job.status).toBe("SUCCEEDED");
  });
  it("blocks multi-quantity eBay drafts before provider work", async () => {
    const h = harness(); h.item.listingDrafts[0].marketplaceDrafts.ebay.quantity = 2; await h.run();
    expect(h.deps.fetchComps).not.toHaveBeenCalled(); expect(h.deps.publish).not.toHaveBeenCalled(); expect(h.job.status).toBe("FAILED");
  });
  it("expires old authorization before any provider work", async () => {
    const h = harness(); (h.job.payload as Record<string, unknown>).authorizedAt = "2020-01-01T00:00:00.000Z"; await h.run();
    expect(h.deps.fetchComps).not.toHaveBeenCalled(); expect(h.job.status).toBe("FAILED");
  });
  it("does not access providers when membership changed", async () => {
    const h = harness(); h.deps.entitlements.mockResolvedValue({ account: { id: "other" }, access: { paidComps: true } });
    await h.run(); expect(h.deps.fetchComps).not.toHaveBeenCalled(); expect(h.job.status).toBe("FAILED");
  });
  it("parks uncertain identity without buying comparisons", async () => {
    const h = harness(); h.item.confidence = 0.5; await h.run();
    expect(h.deps.fetchComps).not.toHaveBeenCalled(); expect(h.deps.publish).not.toHaveBeenCalled();
    expect(h.job.result).toMatchObject({ blocker: "identification_review", recoveryAction: null });
  });
  it("does not change prices or publish outside the authorized range", async () => {
    const h = harness(); h.deps.fetchComps.mockResolvedValue({ summary: { recommendedListCents: 50000, confidence: "high", soldCompCount: 10, pricingBasis: "sold_comps" } });
    await h.run(); expect(h.db.inventoryItem.updateMany).not.toHaveBeenCalled(); expect(h.deps.publish).not.toHaveBeenCalled();
  });
  it("stops on concurrent seller edits", async () => {
    const h = harness(); h.db.listingDraft.updateMany.mockResolvedValue({ count: 0 }); await h.run();
    expect(h.deps.publish).not.toHaveBeenCalled(); expect(h.job.status).toBe("FAILED");
  });
  it("never replays an interrupted running job", async () => {
    const h = harness(); Object.assign(h.job, { status: "RUNNING" }); await h.run();
    expect(h.deps.fetchComps).not.toHaveBeenCalled(); expect(h.deps.publish).not.toHaveBeenCalled();
  });
  it("does not label a disabled publish as success", async () => {
    const h = harness(); h.deps.publish.mockResolvedValue({ outcome: { status: "not_enabled" } }); await h.run();
    expect(h.job.status).toBe("FAILED");
  });
  it("retains a failed state without leaking provider errors", async () => {
    const h = harness(); h.deps.fetchComps.mockRejectedValue(new Error("private-provider-payload")); await h.run();
    expect(JSON.stringify(h.job)).not.toContain("private-provider-payload"); expect(h.job.status).toBe("FAILED");
    expect(h.job.result).toMatchObject({ phase: "preparing", recoveryAction: "retry_preparation" });
    expect(h.db.reviewTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({ accountId: "account", userId: "user", inventoryItemId: "item", type: "sync_conflict", dedupeKey: "listing-automation:job" }) });
    expect(JSON.stringify(h.db.reviewTask.create.mock.calls)).not.toContain("private-provider-payload");
  });
  it("persists the publication boundary before an external call and forbids automatic recovery afterward", async () => {
    const h = harness();
    h.deps.publish.mockImplementation(async () => {
      expect(h.job.result).toMatchObject({ phase: "publishing", recoveryAction: null });
      throw new Error("External outcome unknown");
    });
    await h.run();
    expect(h.job.status).toBe("FAILED");
    expect(h.job.result).toMatchObject({ phase: "publishing", recoveryAction: null });
  });
  it("creates a review task in the inventory owner's account even when payload ownership is invalid", async () => {
    const h = harness(); Object.assign(h.job.payload, { accountId: "other-account" });
    await h.run();
    expect(h.db.reviewTask.create).toHaveBeenCalledWith({ data: expect.objectContaining({ accountId: "account" }) });
    expect(h.deps.publish).not.toHaveBeenCalled();
  });
  it("parks interrupted jobs with one deduplicated account-scoped review task", async () => {
    const h = harness(); Object.assign(h.job, { status: "RUNNING" });
    h.db.jobLog.findMany.mockResolvedValueOnce([h.job]).mockResolvedValueOnce([]);
    await runListingQueue(h.db as never);
    expect(h.job.status).toBe("FAILED"); expect(h.db.reviewTask.create).toHaveBeenCalledTimes(1);
    expect(h.db.reviewTask.findFirst).toHaveBeenCalledWith({ where: { accountId: "account", type: "sync_conflict", status: "open", inventoryItemId: "item", marketplace: null, dedupeKey: "listing-automation:job" }, select: { id: true } });
  });
});
