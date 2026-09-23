import { z } from "zod";
import { getPrisma } from "@/lib/prisma";
import { resolveRuntimeEntitlements } from "@/lib/auth/feature-access";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { AppError, logUnexpectedError } from "@/lib/errors";
import { assertBulkBatchSize } from "@/lib/billing/batch";
import { assertBulkIntakeEnabled } from "./config";
import { generateBulkItem, getBulkBatchView, groupBulkPhotosInTransaction, lockBulkBatch, recoverStaleBulkGeneration, refreshBulkBatch, requireOwnedBulkBatch, type BulkIntakeUser } from "./service";
import type { AccountRecord } from "@/lib/billing/account";
import type { BulkPhotoGroupInput } from "./validation";

export const BULK_GENERATION_QUEUE = "bulk-generation-v1";
const payloadSchema = z.object({
  version: z.literal(1), accountId: z.string().min(1), userId: z.string().min(1),
  batchId: z.string().min(1), itemId: z.string().min(1), attempts: z.number().int().nonnegative(),
}).strict();
type Db = ReturnType<typeof getPrisma>;

export async function enqueueBulkGeneration(args: {
  batchId: string; account: AccountRecord; user: BulkIntakeUser;
  groups?: BulkPhotoGroupInput[]; itemId?: string;
}, db: Db = getPrisma()) {
  assertBulkIntakeEnabled();
  const jobIds = await db.$transaction(async (tx) => {
    const scoped = tx as unknown as Db;
    await lockBulkBatch(args.batchId, scoped);
    let batch = await requireOwnedBulkBatch(args.batchId, args.account.id, scoped);
    if (batch.status === "canceled") throw new AppError("Canceled batches cannot be generated.", 409);
    if (args.groups && batch.status !== "processing") {
      await groupBulkPhotosInTransaction({ ...args, groups: args.groups }, scoped);
      batch = await requireOwnedBulkBatch(args.batchId, args.account.id, scoped);
    }
    assertBulkBatchSize(args.account, batch.items.length, args.user);
    if (args.itemId && !batch.items.some(item => item.id === args.itemId)) throw new AppError("Bulk item not found.", 404);
    const items = batch.items.filter(item =>
      (!args.itemId || item.id === args.itemId) && !item.inventoryItemId &&
      ["ready_for_generation", "failed", "needs_review"].includes(item.status) &&
      !["BULK_GENERATION_STALE", "BULK_GENERATION_UNCERTAIN"].includes(item.errorCode ?? ""));
    const ids: string[] = [];
    for (const item of items) {
      const id = `bulk-identify:${item.id}:${item.generationAttempts}`;
      await tx.jobLog.upsert({ where: { id }, create: {
        id, queueName: BULK_GENERATION_QUEUE, jobName: "identify-and-prepare", status: "QUEUED",
        payload: { version: 1, accountId: args.account.id, userId: args.user.id,
          batchId: batch.id, itemId: item.id, attempts: item.generationAttempts },
      }, update: {} });
      // Only a new seller request may retry a stopped job. Completed attempts
      // have another key; interrupted provider work is excluded above.
      await tx.jobLog.updateMany({ where: { id, status: "FAILED" }, data: { status: "QUEUED", errorMessage: null } });
      ids.push(id);
    }
    if (ids.length) await tx.bulkBatch.update({ where: { id: batch.id }, data: { status: "processing" } });
    return ids;
  });
  return { jobIds, itemIds: [] as string[], batch: await getBulkBatchView(args.batchId, args.account.id, db) };
}

export const bulkJobDeps = {
  resolveUser: async (id: string) => {
    const { data, error } = await createSupabaseServiceClient().auth.admin.getUserById(id);
    if (error || !data.user) throw new AppError("Sign in again to continue this batch.", 401);
    return data.user;
  },
  entitlements: resolveRuntimeEntitlements,
  generate: generateBulkItem,
};

export async function runBulkGenerationJob(id: string, db: Db = getPrisma(), deps = bulkJobDeps) {
  const job = await db.jobLog.findFirst({ where: { id, queueName: BULK_GENERATION_QUEUE, status: "QUEUED" } });
  if (!job) return;
  const claimed = await db.jobLog.updateMany({ where: { id, status: "QUEUED", updatedAt: job.updatedAt }, data: { status: "RUNNING" } });
  if (claimed.count !== 1) return;
  const parsed = payloadSchema.safeParse(job.payload);
  try {
    if (!parsed.success) throw new AppError("This batch job is invalid. Review the batch.", 409);
    const payload = parsed.data;
    const user = await deps.resolveUser(payload.userId);
    const access = await deps.entitlements(user, db);
    if (user.id !== payload.userId || access.account.id !== payload.accountId) throw new AppError("Account access changed. Review this batch.", 403);
    const batch = await requireOwnedBulkBatch(payload.batchId, payload.accountId, db);
    if (batch.status === "canceled") throw new AppError("This batch was canceled.", 409);
    assertBulkBatchSize({ ...access.account, plan: access.plan }, batch.items.length, user);
    const result = await deps.generate({ batchId: payload.batchId, itemId: payload.itemId,
      account: { ...access.account, plan: access.plan }, user, expectedAttempts: payload.attempts }, db);
    await db.jobLog.updateMany({ where: { id, status: "RUNNING" }, data: {
      status: result.inventoryItemId ? "SUCCEEDED" : "FAILED",
      result: { state: result.status, inventoryItemId: result.inventoryItemId },
      errorMessage: result.inventoryItemId ? null : (result.errorMessage ?? result.reviewReason ?? "Review this item before retrying."),
    } });
  } catch (error) {
    logUnexpectedError("bulk_generation_job", error);
    const message = error instanceof AppError ? error.message : "Bulk preparation stopped. Review this batch.";
    await db.jobLog.updateMany({ where: { id, status: "RUNNING" }, data: { status: "FAILED", errorMessage: message } });
    if (parsed.success) {
      const payload = parsed.data;
      await db.bulkItem.updateMany({ where: { id: payload.itemId, batchId: payload.batchId, accountId: payload.accountId,
        inventoryItemId: null, generationAttempts: payload.attempts, status: { in: ["ready_for_generation", "failed", "needs_review"] } },
      data: { status: "needs_review", reviewReason: message } });
      await refreshBulkBatch(payload.batchId, db);
    }
  }
}

export async function runBulkGenerationQueue(db: Db = getPrisma(), deadline = Date.now() + 180_000) {
  // Include interrupted batches created before durable job records existed.
  const interrupted = await db.bulkItem.findMany({ where: { status: "generating", inventoryItemId: null,
    generationStartedAt: { lte: new Date(Date.now() - 15 * 60_000) } },
    distinct: ["batchId", "accountId"], take: 20, select: { batchId: true, accountId: true } });
  for (const batch of interrupted) {
    if (Date.now() >= deadline) return 0;
    await recoverStaleBulkGeneration(batch.batchId, batch.accountId, new Date(), db);
  }
  const stale = await db.jobLog.findMany({ where: { queueName: BULK_GENERATION_QUEUE, status: "RUNNING", updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } }, take: 20 });
  for (const job of stale) {
    if (Date.now() >= deadline) return 0;
    const parsed = payloadSchema.safeParse(job.payload);
    await db.jobLog.updateMany({ where: { id: job.id, status: "RUNNING", updatedAt: job.updatedAt }, data: {
      status: "FAILED", errorMessage: "Generation was interrupted. Review this batch before retrying.",
    } });
    if (parsed.success) {
      await db.bulkItem.updateMany({ where: { id: parsed.data.itemId, accountId: parsed.data.accountId,
        inventoryItemId: null, status: "ready_for_generation" }, data: { status: "needs_review", reviewReason: "Preparation was interrupted before generation. Continue to retry." } });
      await refreshBulkBatch(parsed.data.batchId, db);
    }
  }
  const jobs = await db.jobLog.findMany({ where: { queueName: BULK_GENERATION_QUEUE, status: "QUEUED" }, orderBy: { createdAt: "asc" }, take: 5, select: { id: true } });
  let processed = 0;
  for (const job of jobs) {
    if (Date.now() >= deadline) break;
    await runBulkGenerationJob(job.id, db);
    processed++;
  }
  return processed;
}
