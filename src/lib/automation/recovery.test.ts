import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { automationJobData } from "./listing-job";
import { preparationRecoveryAction, retryListingPreparation } from "./recovery";

function harness() {
  const job = { ...automationJobData({ id: "old", inventoryItemId: "item", accountId: "account", userId: "original-user", policy: { mode: "prepare" }, warnings: [] }), status: "FAILED", updatedAt: new Date(), result: { message: "Provider unavailable" } as Record<string, unknown> };
  const db = {
    jobLog: { findFirst: vi.fn(async () => job), updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn() },
    inventoryItem: { findFirst: vi.fn(async () => ({ status: "DRAFT_READY", quantityAvailable: 1 })) },
    reviewTask: { updateMany: vi.fn(async () => ({ count: 1 })) },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (fn) => fn(db));
  const run = () => retryListingPreparation({ inventoryItemId: "item", accountId: "account", userId: "current-user" }, db as never);
  return { job, db, run };
}
describe("explicit preparation recovery", () => {
  it("preserves original evidence while creating new prepare-only work for the current member", async () => {
    const h = harness(); const id = await h.run();
    expect(h.db.jobLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { inventoryItemId: "item", inventoryItem: { accountId: "account" }, queueName: "listing-automation-v1" } }));
    expect(h.db.jobLog.updateMany).toHaveBeenCalledWith({ where: { id: "old", status: "FAILED", updatedAt: h.job.updatedAt }, data: { result: { message: "Provider unavailable", recoveryJobId: id } } });
    expect(h.db.jobLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ id, status: "QUEUED", payload: expect.objectContaining({ accountId: "account", userId: "current-user", policy: { mode: "prepare" }, warnings: [] }) }) });
    expect(h.db.reviewTask.updateMany).toHaveBeenCalledWith({ where: { accountId: "account", inventoryItemId: "item", type: "sync_conflict", status: "open", dedupeKey: "listing-automation:old" }, data: { status: "resolved", resolvedAt: expect.any(Date) } });
  });
  it("does not recreate expired publishing consent on pre-publish recovery", async () => {
    const h = harness();
    Object.assign(h.job.payload, { policy: { mode: "publish", marketplace: "ebay", consent: true, minPriceCents: 100, maxPriceCents: 10000 }, authorizedAt: "2020-01-01T00:00:00.000Z" });
    h.job.result = { phase: "preparing", recoveryAction: "retry_preparation" };
    await h.run();
    expect(h.db.jobLog.create.mock.calls[0][0].data.payload.policy).toEqual({ mode: "prepare" });
  });
  it.each(["QUEUED", "RUNNING", "SUCCEEDED"])("does not retry %s work", async (status) => {
    const h = harness(); h.job.status = status;
    await expect(h.run()).rejects.toMatchObject({ status: 409 }); expect(h.db.jobLog.create).not.toHaveBeenCalled();
  });
  it.each([{}, { phase: "publishing" }, { phase: "publishing", recoveryAction: "retry_preparation" }])("blocks unproven/ambiguous publication history: %j", async (result) => {
    const h = harness(); Object.assign(h.job.payload, { policy: { mode: "publish", marketplace: "ebay", consent: true, minPriceCents: 100, maxPriceCents: 10000 } }); h.job.result = result;
    await expect(h.run()).rejects.toMatchObject({ status: 409 }); expect(h.db.jobLog.create).not.toHaveBeenCalled();
  });
  it("blocks duplicate and racing retries before another job is created", async () => {
    const h = harness(); h.job.result = { recoveryJobId: "already-created" };
    await expect(h.run()).rejects.toMatchObject({ status: 409 });
    h.job.result = {}; h.db.jobLog.updateMany.mockResolvedValue({ count: 0 });
    await expect(h.run()).rejects.toMatchObject({ status: 409 }); expect(h.db.jobLog.create).not.toHaveBeenCalled();
  });
  it("fails closed for a payload whose account differs from its inventory", async () => {
    const h = harness(); Object.assign(h.job.payload, { accountId: "other" });
    await expect(h.run()).rejects.toMatchObject({ status: 404 }); expect(h.db.jobLog.updateMany).not.toHaveBeenCalled();
  });
  it("blocks sold inventory and never changes sold state", async () => {
    const h = harness(); h.db.inventoryItem.findFirst.mockResolvedValue({ status: "SOLD", quantityAvailable: 0 });
    await expect(h.run()).rejects.toMatchObject({ status: 409 }); expect(h.db.jobLog.create).not.toHaveBeenCalled();
  });
  it("does not expose recovery for invalid payloads", () => {
    expect(preparationRecoveryAction({ status: "FAILED", payload: {}, result: { phase: "preparing", recoveryAction: "retry_preparation" } })).toBeNull();
  });
  it("does not offer or enqueue futile retries for immutable identification warnings", async () => {
    const h = harness(); Object.assign(h.job.payload, { warnings: ["Confirm size"] });
    h.job.result = { phase: "preparing", recoveryAction: "retry_preparation" };
    expect(preparationRecoveryAction(h.job)).toBeNull();
    await expect(h.run()).rejects.toMatchObject({ status: 409 });
    expect(h.db.jobLog.create).not.toHaveBeenCalled(); expect(h.db.reviewTask.updateMany).not.toHaveBeenCalled();
  });
  it("does not retry an identification-confidence review blocker", async () => {
    const h = harness(); h.job.result = { blocker: "identification_review", phase: "preparing", recoveryAction: null };
    expect(preparationRecoveryAction(h.job)).toBeNull();
    await expect(h.run()).rejects.toMatchObject({ status: 409 }); expect(h.db.jobLog.create).not.toHaveBeenCalled();
  });
});
