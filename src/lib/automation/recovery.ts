import { randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { AppError } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { automationJobData, JobPayloadSchema, LISTING_QUEUE } from "./listing-job";
import { listingReviewKey } from "./review";

type RecoverableJob = { status: string; payload: unknown; result: unknown };

function resultRecord(result: unknown): Record<string, unknown> {
  return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : {};
}

export function preparationRecoveryAction(job: RecoverableJob): "retry_preparation" | null {
  const payload = JobPayloadSchema.safeParse(job.payload);
  const result = resultRecord(job.result);
  if (job.status !== "FAILED" || !payload.success || result.recoveryJobId || result.phase === "publishing") return null;
  // Legacy prepare-only jobs cannot have published. Legacy publishing jobs have
  // no trustworthy checkpoint, so require manual marketplace reconciliation.
  return payload.data.policy.mode === "prepare" || (result.phase === "preparing" && result.recoveryAction === "retry_preparation")
    ? "retry_preparation" : null;
}

export const PREPARATION_RETRY_MESSAGE = "Checking the listing and pricing again. Nothing will be published.";

export async function retryListingPreparation(input: { inventoryItemId: string; accountId: string; userId: string }, db = getPrisma()) {
  return db.$transaction(async (tx) => {
    const job = await tx.jobLog.findFirst({
      where: { inventoryItemId: input.inventoryItemId, inventoryItem: { accountId: input.accountId }, queueName: LISTING_QUEUE },
      orderBy: { createdAt: "desc" },
    });
    if (!job) throw new AppError("Listing automation not found.", 404);
    if (!preparationRecoveryAction(job)) throw new AppError("This job cannot be retried. Review the listing and marketplace activity first.", 409, "AUTOMATION_RECOVERY_UNAVAILABLE");
    const payload = JobPayloadSchema.parse(job.payload);
    if (payload.accountId !== input.accountId) throw new AppError("Listing automation not found.", 404);
    const item = await tx.inventoryItem.findFirst({ where: { id: input.inventoryItemId, accountId: input.accountId }, select: { status: true, quantityAvailable: true } });
    if (!item || item.status !== "DRAFT_READY" || item.quantityAvailable !== 1) throw new AppError("This listing needs review before preparation can continue.", 409);
    const id = randomUUID();
    const claimed = await tx.jobLog.updateMany({
      where: { id: job.id, status: "FAILED", updatedAt: job.updatedAt },
      data: { result: { ...resultRecord(job.result), recoveryJobId: id } as Prisma.InputJsonValue },
    });
    if (claimed.count !== 1) throw new AppError("Preparation has already been retried. Refresh the listing to see its progress.", 409);
    await tx.jobLog.create({ data: {
      ...automationJobData({ id, ...input, policy: { mode: "prepare" }, warnings: payload.warnings }),
      result: { message: PREPARATION_RETRY_MESSAGE, recoveryAction: null },
    } });
    await tx.reviewTask.updateMany({
      where: { accountId: input.accountId, inventoryItemId: input.inventoryItemId, type: "sync_conflict", status: "open", dedupeKey: listingReviewKey(job.id) },
      data: { status: "resolved", resolvedAt: new Date() },
    });
    return id;
  });
}
