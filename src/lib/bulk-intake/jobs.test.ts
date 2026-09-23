import { bulkJobId } from "./job-id";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { getPrisma } from "@/lib/prisma";

const service = vi.hoisted(() => ({
  generateBulkItem: vi.fn(), getBulkBatchView: vi.fn(), groupBulkPhotosInTransaction: vi.fn(),
  lockBulkBatch: vi.fn(), recoverStaleBulkGeneration: vi.fn(), refreshBulkBatch: vi.fn(), requireOwnedBulkBatch: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./service", () => service);
vi.mock("@/lib/auth/feature-access", () => ({ resolveRuntimeEntitlements: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServiceClient: vi.fn() }));
import { BULK_GENERATION_QUEUE, enqueueBulkGeneration, runBulkGenerationJob, runBulkGenerationQueue } from "./jobs";

type Db = ReturnType<typeof getPrisma>;
const account = { id: "account-1", ownerUserId: "user-1", plan: "free" as const };
const user = { id: "user-1" };
const payload = { version: 1, accountId: account.id, userId: user.id, batchId: "batch-1", itemId: "item-1", attempts: 0 };
const item = { id: "item-1", status: "ready_for_generation", generationAttempts: 0, inventoryItemId: null, errorCode: null };
const batch = { id: "batch-1", status: "needs_review", items: [item] };
function fake() {
  const job = { id: "job-1", queueName: BULK_GENERATION_QUEUE, status: "QUEUED", updatedAt: new Date(), payload };
  const db = {
    jobLog: { findFirst: vi.fn().mockResolvedValue(job), updateMany: vi.fn().mockResolvedValue({ count: 1 }), upsert: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    bulkItem: { updateMany: vi.fn(), findMany: vi.fn().mockResolvedValue([]) }, bulkBatch: { update: vi.fn() },
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation((callback: (tx: typeof db) => unknown) => callback(db));
  const deps = { resolveUser: vi.fn().mockResolvedValue(user), entitlements: vi.fn().mockResolvedValue({ account, plan: "free" }), generate: vi.fn().mockResolvedValue({ status: "listing_ready", inventoryItemId: "inventory-1" }) };
  return { db, prisma: db as unknown as Db, job, deps: deps as unknown as Parameters<typeof runBulkGenerationJob>[2], spies: deps };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("BULK_INTAKE_ENABLED", "true");
  service.requireOwnedBulkBatch.mockResolvedValue(batch);
  service.getBulkBatchView.mockResolvedValue(batch);
});

describe("durable bulk queue", () => {
  it("saves current grouping and jobs under the same account-scoped transaction", async () => {
    const { db, prisma } = fake();
    const groups = [{ photoIds: ["photo-1"] }];
    await enqueueBulkGeneration({ batchId: batch.id, account, user, groups }, prisma);
    expect(service.lockBulkBatch).toHaveBeenCalledWith(batch.id, db);
    expect(service.requireOwnedBulkBatch).toHaveBeenCalledWith(batch.id, account.id, db);
    expect(service.groupBulkPhotosInTransaction).toHaveBeenCalledWith({ batchId: batch.id, account, user, groups }, db);
    expect(db.jobLog.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: bulkJobId("identify", "item-1", 0) }, create: expect.objectContaining({ payload, status: "QUEUED" }), update: {},
    }));
    expect(service.groupBulkPhotosInTransaction.mock.invocationCallOrder[0]).toBeLessThan(db.jobLog.upsert.mock.invocationCallOrder[0]!);
    expect(db.bulkBatch.update).toHaveBeenCalledWith({ where: { id: batch.id }, data: { status: "processing" } });
  });
  it("repeated start requests reuse the same attempt key and never reset running work", async () => {
    const { db, prisma } = fake();
    await enqueueBulkGeneration({ batchId: batch.id, account, user }, prisma);
    await enqueueBulkGeneration({ batchId: batch.id, account, user }, prisma);
    expect(db.jobLog.upsert.mock.calls.map(([arg]) => arg.where.id)).toEqual([bulkJobId("identify", "item-1", 0), bulkJobId("identify", "item-1", 0)]);
    expect(db.jobLog.updateMany.mock.calls.every(([arg]) => arg.where.status === "FAILED")).toBe(true);
  });
  it("does not enqueue completed, canceled, or uncertain items", async () => {
    const { db, prisma } = fake();
    service.requireOwnedBulkBatch.mockResolvedValue({ ...batch, items: [
      { ...item, inventoryItemId: "saved" }, { ...item, status: "canceled" },
      { ...item, status: "needs_review", errorCode: "BULK_GENERATION_STALE" },
      { ...item, status: "needs_review", errorCode: "BULK_GENERATION_UNCERTAIN" },
    ] });
    await enqueueBulkGeneration({ batchId: batch.id, account, user }, prisma);
    expect(db.jobLog.upsert).not.toHaveBeenCalled();
  });
  it("does not run a provider after losing a concurrent claim", async () => {
    const { db, prisma, deps, spies } = fake();
    db.jobLog.updateMany.mockResolvedValue({ count: 0 });
    await runBulkGenerationJob("job-1", prisma, deps);
    expect(spies.resolveUser).not.toHaveBeenCalled();
    expect(spies.generate).not.toHaveBeenCalled();
  });
  it("rechecks user account access before calling generation", async () => {
    const { db, prisma, deps, spies } = fake();
    spies.entitlements.mockResolvedValue({ account: { ...account, id: "other-account" }, plan: "free" });
    await runBulkGenerationJob("job-1", prisma, deps);
    expect(spies.generate).not.toHaveBeenCalled();
    expect(db.jobLog.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: { status: "FAILED", errorMessage: "Account access changed. Review this batch." } }));
    expect(db.bulkItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ accountId: account.id, batchId: batch.id, generationAttempts: 0 }), data: expect.objectContaining({ status: "needs_review" }) }));
  });
  it("canceled batches never call generation", async () => {
    const { prisma, deps, spies } = fake();
    service.requireOwnedBulkBatch.mockResolvedValue({ ...batch, status: "canceled" });
    await runBulkGenerationJob("job-1", prisma, deps);
    expect(spies.generate).not.toHaveBeenCalled();
  });
  it("passes an expected attempt and current entitlements to the budget-guarded service", async () => {
    const { db, prisma, deps, spies } = fake();
    await runBulkGenerationJob("job-1", prisma, deps);
    expect(spies.generate).toHaveBeenCalledWith({ batchId: batch.id, itemId: item.id, user, account, expectedAttempts: 0, deadline: expect.any(Number) }, prisma);
    expect(db.jobLog.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SUCCEEDED" }) }));
  });
  it("parks interrupted jobs without replaying a provider", async () => {
    const { db, prisma, job } = fake();
    db.bulkItem.findMany.mockResolvedValue([{ batchId: batch.id, accountId: account.id }]);
    db.jobLog.findMany.mockResolvedValueOnce([{ ...job, status: "RUNNING" }]).mockResolvedValueOnce([]);
    await runBulkGenerationQueue(prisma);
    expect(service.recoverStaleBulkGeneration).toHaveBeenCalledWith(batch.id, account.id, expect.any(Date), prisma);
    expect(db.jobLog.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: job.id, status: "RUNNING", updatedAt: job.updatedAt }, data: expect.objectContaining({ status: "FAILED" }) }));
    expect(service.generateBulkItem).not.toHaveBeenCalled();
  });
  it("leaves work queued when less than 90 seconds remain", async () => {
    const { db, prisma } = fake();
    db.jobLog.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "job-1" }]);
    expect(await runBulkGenerationQueue(prisma, Date.now() + 89_000)).toBe(0);
    expect(db.jobLog.findFirst).not.toHaveBeenCalled();
  });
});
