import type {
  Prisma,
  SyncJobStatus,
  SyncJobType,
} from "@/generated/prisma/client";
import { safeFailureText } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";

// Durable, idempotent work records for the safety engine. Enqueue is an UPSERT
// keyed on the FULL-unique idempotencyKey: re-enqueueing the same key is a
// no-op (returns the existing row, leaves status/attempts untouched), so marking
// an item sold twice can never duplicate its delist jobs. A separate worker (not
// in this layer) executes the jobs and calls the markSucceeded/markFailed
// helpers. No live network calls happen here.

export type SyncJobRow = {
  id: string;
  type: SyncJobType;
  status: SyncJobStatus;
  idempotencyKey: string;
  attempts: number;
};

export type SyncJobPrismaLike = {
  syncJob: {
    upsert(args: {
      where: { idempotencyKey: string };
      // On conflict we intentionally do nothing: the existing row wins. Prisma
      // has no native "ON CONFLICT DO NOTHING", so update is an empty patch.
      update: Record<string, never>;
      create: {
        userId: string;
        type: SyncJobType;
        status: SyncJobStatus;
        inventoryItemId?: string | null;
        marketplaceListingId?: string | null;
        idempotencyKey: string;
        payload: Prisma.InputJsonValue;
        runAfter?: Date | null;
      };
      select: {
        id: true;
        type: true;
        status: true;
        idempotencyKey: true;
        attempts: true;
      };
    }): Promise<SyncJobRow>;
    update(args: {
      where: { id: string };
      data: {
        status?: SyncJobStatus;
        attempts?: { increment: number };
        errorCode?: string | null;
        errorMessage?: string | null;
      };
    }): Promise<{ id: string }>;
  };
};

export type EnqueueSyncJobInput = {
  userId: string;
  type: SyncJobType;
  idempotencyKey: string;
  inventoryItemId?: string | null;
  marketplaceListingId?: string | null;
  payload?: Prisma.InputJsonValue;
  runAfter?: Date | null;
  // Jobs that need seller action before a worker should run them (e.g. a
  // non-eBay channel with no delist adapter) are created as needs_review.
  status?: SyncJobStatus;
};

export async function enqueueSyncJob(
  db: SyncJobPrismaLike = getPrisma(),
  input: EnqueueSyncJobInput,
): Promise<SyncJobRow> {
  return db.syncJob.upsert({
    where: { idempotencyKey: input.idempotencyKey },
    update: {},
    create: {
      userId: input.userId,
      type: input.type,
      status: input.status ?? "queued",
      inventoryItemId: input.inventoryItemId ?? null,
      marketplaceListingId: input.marketplaceListingId ?? null,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload ?? {},
      runAfter: input.runAfter ?? null,
    },
    select: {
      id: true,
      type: true,
      status: true,
      idempotencyKey: true,
      attempts: true,
    },
  });
}

export async function markSyncJobSucceeded(
  db: SyncJobPrismaLike = getPrisma(),
  jobId: string,
): Promise<void> {
  await db.syncJob.update({
    where: { id: jobId },
    data: {
      status: "succeeded",
      attempts: { increment: 1 },
      errorCode: null,
      errorMessage: null,
    },
  });
}

export async function markSyncJobFailed(
  db: SyncJobPrismaLike = getPrisma(),
  jobId: string,
  failure: { code?: string; error?: unknown } = {},
): Promise<void> {
  // Never persist raw provider/DB/internal text: scrub the message and keep only
  // a short, safe summary alongside a stable code.
  const message =
    failure.error instanceof Error ? failure.error.message : undefined;
  await db.syncJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      attempts: { increment: 1 },
      errorCode: failure.code ?? null,
      errorMessage: safeFailureText(message, "The sync job failed."),
    },
  });
}
