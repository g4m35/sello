import { BulkStepTimeout, withinBulkDeadline } from "./deadline";
import { bulkJobId } from "./job-id";
import { randomUUID } from "node:crypto";

import { automationJobData } from "@/lib/automation/listing-job";

import { Prisma } from "@/generated/prisma/client";
import { generateListingDraftWithGemini, GEMINI_PROMPT_VERSION } from "@/lib/ai/gemini";
import { assertBulkBatchSize } from "@/lib/billing/batch";
import { effectiveLimitsForUser } from "@/lib/billing/effective-plan";
import type { AccountRecord } from "@/lib/billing/account";
import {
  markUsageReconciliationRequired,
  markUsageWorkStarted,
  releaseUsageReservation,
  reserveUsageOrThrow,
  settleUsageReservationOrRequireReconciliation,
} from "@/lib/billing/usage";
import {
  AppError,
  logUnexpectedError,
  safePersistedFailureReason,
} from "@/lib/errors";
import { applyDefaultEbayDraftFields } from "@/lib/listing/default-ebay-draft";
import { asStringRecord } from "@/lib/listing/ebay-draft-fields";
import { getPrisma } from "@/lib/prisma";
import {
  downloadListingPhotos,
} from "@/lib/storage/listing-photos";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { MAX_LISTING_PHOTOS } from "@/lib/uploads";

import { assertBulkIntakeEnabled } from "./config";
import {
  bulkPhotoStoragePath,
  createBulkPhotoUploadGrant,
  getBulkPhotoStorage,
  validateStoredBulkPhoto,
} from "./photo-storage";
import {
  assertBulkItemTransition,
  summarizeBulkItems,
  type BulkItemStatusValue,
} from "./status";
import type {
  BulkBatchSummaryView,
  BulkBatchView,
  BulkGenerationResult,
  BulkPhotoUploadGrant,
  BulkPhotoView,
} from "./types";
import {
  MAX_BULK_ITEMS,
  type BulkPhotoRegistrationInput,
  type BulkPhotoUploadInput,
  type BulkPhotoGroupInput,
} from "./validation";

type Db = ReturnType<typeof getPrisma>;
const BULK_GENERATION_STALE_MS = 15 * 60 * 1000;

export type BulkIntakeUser = {
  id: string;
  email?: string | null;
};

const batchInclude = {
  photos: { orderBy: { position: "asc" as const } },
  items: {
    orderBy: { position: "asc" as const },
    include: { photos: { orderBy: { itemPosition: "asc" as const } } },
  },
} satisfies Prisma.BulkBatchInclude;

type BulkBatchRecord = Prisma.BulkBatchGetPayload<{ include: typeof batchInclude }>;

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "P2002",
  );
}

async function mapWithConcurrency<T, R>(
  values: T[],
  limit: number,
  callback: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await callback(values[index]!, index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return results;
}

function assertBatchAcceptsPhotos(batch: BulkBatchRecord): void {
  if (batch.status === "canceled") {
    throw new AppError("Canceled batches cannot accept photos.", 409, "BULK_BATCH_CANCELED");
  }
  if (batch.items.length > 0) {
    throw new AppError(
      "Regroup or finish this batch before adding more photos.",
      409,
      "BULK_BATCH_ALREADY_GROUPED",
    );
  }
}

function assertBulkPhotoCapacity(
  batch: BulkBatchRecord,
  account: AccountRecord,
  user: BulkIntakeUser,
  requestedUploadIds: string[],
): void {
  if (new Set(requestedUploadIds).size !== requestedUploadIds.length) {
    throw new AppError(
      "Each photo upload id must be unique.",
      400,
      "BULK_PHOTO_UPLOAD_ID_DUPLICATE",
    );
  }
  const existingIds = new Set(batch.photos.map((photo) => photo.id));
  const newPhotos = requestedUploadIds.filter((id) => !existingIds.has(id)).length;
  const itemLimit = Math.min(
    effectiveLimitsForUser(account, user).bulkBatchSize,
    MAX_BULK_ITEMS,
  );
  const photoLimit = itemLimit * MAX_LISTING_PHOTOS;
  if (batch.photos.length + newPhotos > photoLimit) {
    throw new AppError(
      `Upload no more than ${photoLimit} photos without exceeding this batch's item limit.`,
      400,
      "BULK_PHOTO_LIMIT_EXCEEDED",
    );
  }
}

function assertPhotoMatchesExisting(
  photo: Pick<BulkPhotoUploadInput, "mimeType" | "originalName"> & { storagePath: string },
  existing: BulkBatchRecord["photos"][number],
): void {
  if (
    existing.storagePath !== photo.storagePath ||
    existing.mimeType !== photo.mimeType ||
    existing.originalName !== photo.originalName
  ) {
    throw new AppError(
      "This photo upload conflicts with an existing batch photo.",
      409,
      "BULK_PHOTO_METADATA_CONFLICT",
    );
  }
}

export async function requireOwnedBulkBatch(
  batchId: string,
  accountId: string,
  prisma: Db = getPrisma(),
): Promise<BulkBatchRecord> {
  const batch = await prisma.bulkBatch.findFirst({
    where: { id: batchId, accountId },
    include: batchInclude,
  });
  if (!batch) {
    throw new AppError("Bulk batch not found.", 404, "BULK_BATCH_NOT_FOUND");
  }
  return batch;
}

async function toBatchView(batch: BulkBatchRecord): Promise<BulkBatchView> {
  const storage = createSupabaseServiceClient().storage;
  const signedUrls = new Map<string, string | null>();
  await Promise.all(
    batch.photos.map(async (photo) => {
      const { data } = await storage
        .from(photo.storageBucket)
        .createSignedUrl(photo.storagePath, 60 * 60);
      signedUrls.set(photo.id, data?.signedUrl ?? null);
    }),
  );

  const photoView = (photo: BulkBatchRecord["photos"][number]): BulkPhotoView => ({
    id: photo.id,
    originalName: photo.originalName,
    mimeType: photo.mimeType,
    position: photo.position,
    itemPosition: photo.itemPosition,
    bulkItemId: photo.bulkItemId,
    url: signedUrls.get(photo.id) ?? null,
  });

  return {
    id: batch.id,
    status: batch.status,
    photoCount: batch.photoCount,
    totalItems: batch.totalItems,
    processedItems: batch.processedItems,
    needsReviewItems: batch.needsReviewItems,
    listingReadyItems: batch.listingReadyItems,
    failedItems: batch.failedItems,
    canceledItems: batch.canceledItems,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
    photos: batch.photos.map(photoView),
    items: batch.items.map((item) => ({
      id: item.id,
      position: item.position,
      status: item.status,
      inventoryItemId: item.inventoryItemId,
      reviewReason: item.reviewReason,
      errorCode: item.errorCode,
      errorMessage: item.errorMessage,
      generationAttempts: item.generationAttempts,
      aiProvider: item.aiProvider,
      aiModel: item.aiModel,
      photos: item.photos.map(photoView),
    })),
  };
}

export async function getBulkBatchView(
  batchId: string,
  accountId: string,
  prisma: Db = getPrisma(),
): Promise<BulkBatchView> {
  return toBatchView(await requireOwnedBulkBatch(batchId, accountId, prisma));
}

export async function listBulkBatches(
  accountId: string,
  prisma: Db = getPrisma(),
): Promise<BulkBatchSummaryView[]> {
  const batches = await prisma.bulkBatch.findMany({
    where: { accountId },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
  return batches.map((batch) => ({
    id: batch.id,
    status: batch.status,
    photoCount: batch.photoCount,
    totalItems: batch.totalItems,
    processedItems: batch.processedItems,
    needsReviewItems: batch.needsReviewItems,
    listingReadyItems: batch.listingReadyItems,
    failedItems: batch.failedItems,
    canceledItems: batch.canceledItems,
    createdAt: batch.createdAt.toISOString(),
    updatedAt: batch.updatedAt.toISOString(),
  }));
}

export async function createBulkBatch(
  args: {
    account: AccountRecord;
    user: BulkIntakeUser;
    idempotencyKey?: string;
    expectedItems?: number;
  },
  prisma: Db = getPrisma(),
): Promise<BulkBatchView> {
  if (args.idempotencyKey) {
    const existing = await prisma.bulkBatch.findFirst({
      where: {
        accountId: args.account.id,
        idempotencyKey: args.idempotencyKey,
      },
      include: batchInclude,
    });
    if (existing) return toBatchView(existing);
  }

  assertBulkIntakeEnabled();
  if (args.expectedItems) {
    assertBulkBatchSize(args.account, args.expectedItems, args.user);
  }

  try {
    const created = await prisma.bulkBatch.create({
      data: {
        accountId: args.account.id,
        createdByUserId: args.user.id,
        idempotencyKey: args.idempotencyKey,
      },
      include: batchInclude,
    });
    return toBatchView(created);
  } catch (error) {
    if (args.idempotencyKey && isUniqueViolation(error)) {
      const existing = await prisma.bulkBatch.findFirst({
        where: {
          accountId: args.account.id,
          idempotencyKey: args.idempotencyKey,
        },
        include: batchInclude,
      });
      if (existing) return toBatchView(existing);
    }
    throw error;
  }
}

export async function createBulkPhotoUploadGrants(
  args: {
    batchId: string;
    account: AccountRecord;
    user: BulkIntakeUser;
    photos: BulkPhotoUploadInput[];
  },
  prisma: Db = getPrisma(),
): Promise<BulkPhotoUploadGrant[]> {
  assertBulkIntakeEnabled();
  const batch = await requireOwnedBulkBatch(args.batchId, args.account.id, prisma);
  assertBatchAcceptsPhotos(batch);
  assertBulkPhotoCapacity(
    batch,
    args.account,
    args.user,
    args.photos.map((photo) => photo.uploadId),
  );

  const existingById = new Map(batch.photos.map((photo) => [photo.id, photo]));
  for (const photo of args.photos) {
    const existing = existingById.get(photo.uploadId);
    if (!existing) continue;
    assertPhotoMatchesExisting(
      {
        ...photo,
        storagePath: bulkPhotoStoragePath(args.account.id, batch.id, photo),
      },
      existing,
    );
  }

  const { bucket, files } = getBulkPhotoStorage();
  return mapWithConcurrency(args.photos, 8, (photo) =>
    createBulkPhotoUploadGrant(bucket, files, args.account.id, batch.id, photo),
  );
}

export async function registerBulkPhotos(
  args: {
    batchId: string;
    account: AccountRecord;
    user: BulkIntakeUser;
    photos: BulkPhotoRegistrationInput[];
  },
  prisma: Db = getPrisma(),
): Promise<BulkBatchView> {
  assertBulkIntakeEnabled();
  const batch = await requireOwnedBulkBatch(args.batchId, args.account.id, prisma);
  assertBatchAcceptsPhotos(batch);
  assertBulkPhotoCapacity(
    batch,
    args.account,
    args.user,
    args.photos.map((photo) => photo.uploadId),
  );

  const existingIds = new Set(batch.photos.map((photo) => photo.id));
  const unregistered = args.photos.filter((photo) => !existingIds.has(photo.uploadId));

  for (const photo of args.photos) {
    const expectedPath = bulkPhotoStoragePath(args.account.id, batch.id, photo);
    if (photo.storagePath !== expectedPath) {
      throw new AppError(
        "The photo upload does not belong to this account and batch.",
        400,
        "BULK_PHOTO_PATH_INVALID",
      );
    }
    const existing = batch.photos.find((row) => row.id === photo.uploadId);
    if (existing) assertPhotoMatchesExisting(photo, existing);
  }

  const { bucket, files } = getBulkPhotoStorage();
  await mapWithConcurrency(unregistered, 8, async (photo) => {
    try {
      await validateStoredBulkPhoto(files, photo);
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.code === "BULK_PHOTO_INVALID" ||
          error.code === "BULK_PHOTO_DIMENSIONS_TOO_LARGE")
      ) {
        await files
          .remove([photo.storagePath])
          .catch((cleanupError) => logUnexpectedError("bulk_photo_invalid_cleanup", cleanupError));
      }
      throw error;
    }
  });

  await prisma.$transaction(async (transaction) => {
    await lockBulkBatch(batch.id, transaction as unknown as Db);
    const locked = await requireOwnedBulkBatch(
      batch.id,
      args.account.id,
      transaction as unknown as Db,
    );
    assertBatchAcceptsPhotos(locked);
    assertBulkPhotoCapacity(
      locked,
      args.account,
      args.user,
      args.photos.map((photo) => photo.uploadId),
    );

    const lockedById = new Map(locked.photos.map((photo) => [photo.id, photo]));
    for (const photo of args.photos) {
      const existing = lockedById.get(photo.uploadId);
      if (existing) assertPhotoMatchesExisting(photo, existing);
    }
    const newPhotos = args.photos.filter((photo) => !lockedById.has(photo.uploadId));
    if (newPhotos.length === 0) return;

    const firstPosition =
      locked.photos.reduce((maximum, photo) => Math.max(maximum, photo.position), -1) + 1;
    await transaction.bulkPhoto.createMany({
      data: newPhotos.map((photo, index) => ({
        id: photo.uploadId,
        batchId: batch.id,
        accountId: args.account.id,
        storageBucket: bucket,
        storagePath: photo.storagePath,
        mimeType: photo.mimeType,
        originalName: photo.originalName,
        position: firstPosition + index,
      })),
    });
    await transaction.bulkBatch.update({
      where: { id: batch.id },
      data: {
        status: "uploading",
        photoCount: locked.photos.length + newPhotos.length,
      },
    });
  });
  return getBulkBatchView(batch.id, args.account.id, prisma);
}

export async function lockBulkBatch(batchId: string, prisma: Db) {
  await prisma.$executeRawUnsafe(
    "SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))",
    `bulk-generation:${batchId}`,
  );
}

export async function groupBulkPhotos(
  args: Parameters<typeof groupBulkPhotosInTransaction>[0],
  prisma: Db = getPrisma(),
): Promise<BulkBatchView> {
  await prisma.$transaction(async (tx) => {
    await lockBulkBatch(args.batchId, tx as unknown as Db);
    await groupBulkPhotosInTransaction(args, tx as unknown as Db);
  });
  return getBulkBatchView(args.batchId, args.account.id, prisma);
}

export async function groupBulkPhotosInTransaction(
  args: {
    batchId: string;
    account: AccountRecord;
    user: BulkIntakeUser;
    groups: BulkPhotoGroupInput[];
  },
  prisma: Db = getPrisma(),
): Promise<void> {
  const batch = await requireOwnedBulkBatch(args.batchId, args.account.id, prisma);
  if (batch.status === "canceled") {
    throw new AppError("Canceled batches cannot be regrouped.", 409, "BULK_BATCH_CANCELED");
  }
  assertBulkBatchSize(args.account, args.groups.length, args.user);
  if (args.groups.length > MAX_BULK_ITEMS) {
    throw new AppError(
      `A bulk intake can contain at most ${MAX_BULK_ITEMS} items.`,
      400,
      "BULK_BATCH_ABSOLUTE_LIMIT",
    );
  }

  const hasStarted = batch.items.some(
    (item) =>
      item.inventoryItemId !== null ||
      !["uploaded", "grouping", "ready_for_generation"].includes(item.status),
  );
  if (hasStarted || batch.status === "processing") {
    throw new AppError(
      "Photos can only be regrouped before listing generation starts.",
      409,
      "BULK_GROUPING_LOCKED",
    );
  }

  const requestedIds = args.groups.flatMap((group) => group.photoIds);
  const uniqueIds = new Set(requestedIds);
  const ownedIds = new Set(batch.photos.map((photo) => photo.id));
  if (
    requestedIds.length !== uniqueIds.size ||
    requestedIds.length !== ownedIds.size ||
    requestedIds.some((id) => !ownedIds.has(id))
  ) {
    throw new AppError(
      "Every uploaded photo must belong to exactly one item group.",
      400,
      "BULK_GROUPING_INVALID",
    );
  }

  const groups = args.groups.map((group, position) => ({
    id: randomUUID(),
    position,
    photoIds: group.photoIds,
  }));

  await prisma.bulkPhoto.updateMany({
    where: { batchId: batch.id },
    data: { bulkItemId: null, itemPosition: null },
  });
  await prisma.bulkItem.deleteMany({ where: { batchId: batch.id } });
  await prisma.bulkItem.createMany({
    data: groups.map((group) => ({
      id: group.id,
      batchId: batch.id,
      accountId: args.account.id,
      position: group.position,
      status: "uploaded",
    })),
  });
  await prisma.bulkItem.updateMany({
    where: { batchId: batch.id, status: "uploaded" },
    data: { status: "grouping" },
  });
  for (const group of groups) {
    for (const [itemPosition, photoId] of group.photoIds.entries()) {
      await prisma.bulkPhoto.update({
        where: { id: photoId },
        data: { bulkItemId: group.id, itemPosition },
      });
    }
  }
  await prisma.bulkItem.updateMany({
    where: { batchId: batch.id, status: "grouping" },
    data: { status: "ready_for_generation" },
  });
  await prisma.bulkBatch.update({
    where: { id: batch.id },
    data: {
      status: "needs_review",
      totalItems: groups.length,
      processedItems: 0,
      needsReviewItems: 0,
      listingReadyItems: 0,
      failedItems: 0,
      canceledItems: 0,
    },
  });
}

export async function refreshBulkBatch(
  batchId: string,
  prisma: Db = getPrisma(),
): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const tx = transaction as unknown as Db;
    await lockBulkBatch(batchId, tx);
    const [batch, items] = await Promise.all([
      tx.bulkBatch.findUnique({ where: { id: batchId }, select: { status: true } }),
      tx.bulkItem.findMany({ where: { batchId }, select: { status: true } }),
    ]);
    if (!batch) return;
    const summary = summarizeBulkItems(items);
    const hasQueuedWork = items.some(
      (item) =>
        item.status === "ready_for_generation" ||
        item.status === "generating" ||
        item.status === "grouping",
    );
    await tx.bulkBatch.update({
      where: { id: batchId },
      data: {
        ...summary,
        status:
          batch.status === "canceled"
            ? "canceled"
            : batch.status === "processing" && hasQueuedWork
              ? "processing"
              : summary.status,
      },
    });
  });
}

export async function recoverStaleBulkGeneration(
  batchId: string,
  accountId: string,
  now: Date,
  prisma: Db = getPrisma(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - BULK_GENERATION_STALE_MS);
  const staleItems = await prisma.bulkItem.findMany({
    where: {
      batchId,
      accountId,
      status: "generating",
      inventoryItemId: null,
      generationStartedAt: { lte: cutoff },
    },
    select: { id: true, generationAttempts: true },
  });
  let recovered = 0;
  for (const item of staleItems) {
    const updated = await prisma.bulkItem.updateMany({
      where: {
        id: item.id,
        accountId,
        status: "generating",
        inventoryItemId: null,
        generationAttempts: item.generationAttempts,
        generationStartedAt: { lte: cutoff },
      },
      data: {
        status: "needs_review",
        errorCode: "BULK_GENERATION_STALE",
        errorMessage: "Generation was interrupted. Review this item and its usage before retrying.",
        generationEndedAt: now,
      },
    });
    if (updated.count !== 1) continue;
    recovered += 1;
    const reservation = await prisma.usageReservation.findUnique({
      where: {
        accountId_metric_idempotencyKey: {
          accountId,
          metric: "ai_listing",
          idempotencyKey: `bulk-ai:${item.id}:attempt:${item.generationAttempts}`,
        },
      },
      select: { id: true, status: true },
    });
    if (reservation?.status === "reserved") {
      await markUsageReconciliationRequired(
        reservation.id, now, "BULK_GENERATION_STALE", prisma,
      ).catch(
        (error) => logUnexpectedError("bulk_stale_usage_expiry", error),
      );
    }
  }
  if (recovered > 0) await refreshBulkBatch(batchId, prisma);
  return recovered;
}

function reviewReasonForDraft(result: Awaited<ReturnType<typeof generateListingDraftWithGemini>>) {
  const reasons: string[] = [];
  if (result.draft.identification.confidence < 0.7) {
    reasons.push("AI confidence is below 70%; confirm the item details.");
  }
  if (!result.draft.identification.size) {
    reasons.push("Confirm the size before using this listing.");
  }
  if (result.draft.warnings.length > 0) {
    reasons.push("Review the AI warnings before using this listing.");
  }
  return reasons.length > 0 ? reasons.join(" ") : null;
}

async function generationResult(
  batchId: string,
  itemId: string,
  accountId: string,
  prisma: Db,
): Promise<BulkGenerationResult> {
  const item = await prisma.bulkItem.findFirst({
    where: { id: itemId, batchId, batch: { accountId } },
    select: {
      id: true,
      status: true,
      inventoryItemId: true,
      reviewReason: true,
      errorCode: true,
      errorMessage: true,
    },
  });
  if (!item) {
    throw new AppError("Bulk item not found.", 404, "BULK_ITEM_NOT_FOUND");
  }
  return {
    itemId: item.id,
    status: item.status,
    inventoryItemId: item.inventoryItemId,
    reviewReason: item.reviewReason,
    errorCode: item.errorCode,
    errorMessage: item.errorMessage,
  };
}

export async function generateBulkItem(
  args: {
    batchId: string;
    itemId: string;
    expectedAttempts?: number;
    deadline?: number;
    account: AccountRecord;
    user: BulkIntakeUser;
  },
  prisma: Db = getPrisma(),
): Promise<BulkGenerationResult> {
  const deadline = Math.min(args.deadline ?? Infinity, Date.now() + 120_000);
  const providerDeadline = deadline - 20_000; // Keep time for persistence/reconciliation.
  const item = await prisma.bulkItem.findFirst({
    where: {
      id: args.itemId,
      batchId: args.batchId,
      batch: { accountId: args.account.id },
    },
    include: {
      batch: { select: { status: true } },
      photos: { orderBy: { itemPosition: "asc" } },
    },
  });
  if (!item) {
    throw new AppError("Bulk item not found.", 404, "BULK_ITEM_NOT_FOUND");
  }
  if (item.inventoryItemId || (args.expectedAttempts !== undefined && args.expectedAttempts !== item.generationAttempts)) {
    return generationResult(args.batchId, item.id, args.account.id, prisma);
  }
  if (["BULK_GENERATION_STALE", "BULK_GENERATION_UNCERTAIN"].includes(item.errorCode ?? "")) {
    throw new AppError("Review the interrupted generation and usage before retrying.", 409, "BULK_GENERATION_REVIEW_REQUIRED");
  }
  assertBulkIntakeEnabled();
  if (item.batch.status === "canceled" || item.status === "canceled") {
    throw new AppError("Canceled bulk items cannot be generated.", 409, "BULK_ITEM_CANCELED");
  }
  if (item.photos.length < 1 || item.photos.length > MAX_LISTING_PHOTOS) {
    throw new AppError(
      "Each bulk item needs 1 to 3 grouped photos.",
      400,
      "BULK_ITEM_PHOTOS_INVALID",
    );
  }

  const claimed = await prisma.$transaction(async (transaction) => {
    const tx = transaction as unknown as Db;
    await lockBulkBatch(args.batchId, tx);
    const claimed = await tx.bulkItem.updateMany({
      where: {
        id: item.id,
        batchId: args.batchId,
        accountId: args.account.id,
        generationAttempts: item.generationAttempts,
        batch: { accountId: args.account.id, status: { not: "canceled" } },
        inventoryItemId: null,
        OR: [
          { status: { in: ["ready_for_generation", "failed"] } },
          { status: "needs_review" },
        ],
      },
      data: {
        status: "generating",
        generationAttempts: { increment: 1 },
        generationStartedAt: new Date(),
        generationEndedAt: null,
        reviewReason: null,
        errorCode: null,
        errorMessage: null,
      },
    });
    if (claimed.count === 1) await tx.bulkBatch.update({
      where: { id: args.batchId }, data: { status: "processing" },
    });
    return claimed;
  });
  if (claimed.count !== 1) return generationResult(args.batchId, item.id, args.account.id, prisma);

  let usageReservationId: string | null = null;
  try {
    const active = await prisma.bulkItem.findFirst({ where: {
      id: item.id, accountId: args.account.id, status: "generating", generationAttempts: item.generationAttempts + 1,
      batch: { status: { not: "canceled" } },
    }, select: { id: true } });
    if (!active) return generationResult(args.batchId, item.id, args.account.id, prisma);
    const reservation = await reserveUsageOrThrow({
      accountId: args.account.id,
      metric: "ai_listing",
      idempotencyKey: `bulk-ai:${item.id}:attempt:${item.generationAttempts + 1}`,
      now: new Date(),
      operationType: "bulk_listing",
      operationId: item.id,
      user: args.user,
    }, prisma);
    usageReservationId = reservation.reservationId;
  } catch (error) {
    if (error instanceof AppError && error.code?.startsWith("QUOTA_EXCEEDED")) {
      assertBulkItemTransition("generating", "needs_review");
      await prisma.bulkItem.updateMany({
        where: { id: item.id, accountId: args.account.id, generationAttempts: item.generationAttempts + 1, status: "generating" },
        data: {
          status: "needs_review",
          reviewReason: error.message,
          errorCode: error.code,
          generationEndedAt: new Date(),
        },
      });
      await refreshBulkBatch(args.batchId, prisma);
      return generationResult(args.batchId, item.id, args.account.id, prisma);
    }
    await prisma.bulkItem.updateMany({
      where: { id: item.id, accountId: args.account.id, generationAttempts: item.generationAttempts + 1, status: "generating" },
      data: {
        status: "failed",
        errorCode: "AI_BUDGET_CHECK_FAILED",
        errorMessage: safePersistedFailureReason(
          error,
          "AI budget check failed. Retry this item.",
        ),
        generationEndedAt: new Date(),
      },
    });
    await refreshBulkBatch(args.batchId, prisma);
    return generationResult(args.batchId, item.id, args.account.id, prisma);
  }

  let writeStarted = false;
  let providerStarted = false;
  try {
    const photos = await withinBulkDeadline(() => downloadListingPhotos(
      item.photos.map((photo, position) => ({
        storageBucket: photo.storageBucket,
        storagePath: photo.storagePath,
        mimeType: photo.mimeType,
        originalName: photo.originalName,
        position,
      })),
    ), Math.min(providerDeadline, Date.now() + 30_000));
    if (Date.now() >= providerDeadline) throw new BulkStepTimeout();
    // Linearize cancellation against provider start. Once this commits, cancel
    // can stop saving the result but the already-started provider may finish.
    await prisma.$transaction(async (transaction) => {
      const tx = transaction as unknown as Db;
      await lockBulkBatch(args.batchId, tx);
      const active = await tx.bulkItem.findFirst({ where: {
        id: item.id, accountId: args.account.id, status: "generating", generationAttempts: item.generationAttempts + 1,
        batch: { status: { not: "canceled" } },
      }, select: { id: true } });
      if (!active) throw new AppError("This bulk item was canceled before generation started.", 409, "BULK_ITEM_CANCELED");
      if (!(await markUsageWorkStarted(usageReservationId!, new Date(), tx))) {
        throw new AppError("The usage reservation is no longer active.", 409, "USAGE_RESERVATION_NOT_ACTIVE");
      }
    });
    const gemini = await withinBulkDeadline((signal, timeoutMs) => {
      providerStarted = true;
      return generateListingDraftWithGemini(photos, { signal, timeoutMs: timeoutMs + 1_000 });
    }, providerDeadline);
    const { identification, listingDraft } = gemini.draft;
    const marketplaceDrafts = applyDefaultEbayDraftFields({
      title: listingDraft.title,
      brand: identification.brand,
      description: listingDraft.description,
      productCategory: identification.category,
      size: identification.size,
      itemSpecifics: asStringRecord(listingDraft.itemSpecifics),
      marketplaceDrafts: gemini.draft.marketplaceDrafts,
    });
    const reviewReason = reviewReasonForDraft(gemini);
    const nextStatus: BulkItemStatusValue = reviewReason ? "needs_review" : "listing_ready";
    assertBulkItemTransition("generating", nextStatus);
    const inventoryItemId = randomUUID();

    writeStarted = true;
    await prisma.$transaction(async (tx) => {
      await tx.inventoryItem.create({
        data: {
          id: inventoryItemId,
          sellerId: args.user.id,
          accountId: args.account.id,
          status: "DRAFT_READY",
          productName: identification.productName,
          brand: identification.brand,
          category: identification.category,
          condition: identification.condition,
          styleCode: identification.styleCode,
          colorway: identification.colorway,
          size: identification.size,
          confidence: identification.confidence,
          recommendedPriceCents: listingDraft.recommendedPriceCents,
          pricingRationale: listingDraft.pricingRationale,
        },
      });
      await tx.itemPhoto.createMany({
        data: item.photos.map((photo, position) => ({
          inventoryItemId,
          storageBucket: photo.storageBucket,
          storagePath: photo.storagePath,
          mimeType: photo.mimeType,
          originalName: photo.originalName,
          position,
        })),
      });
      await tx.listingDraft.create({
        data: {
          inventoryItemId,
          title: listingDraft.title,
          description: listingDraft.description,
          bulletPoints: listingDraft.bulletPoints,
          recommendedPriceCents: listingDraft.recommendedPriceCents,
          pricingRationale: listingDraft.pricingRationale,
          itemSpecifics: listingDraft.itemSpecifics as Prisma.InputJsonValue,
          marketplaceDrafts: marketplaceDrafts as Prisma.InputJsonValue,
          measurements: listingDraft.measurements.map((measurement) => ({
            ...measurement,
            source: measurement.source ?? "ai",
          })) as Prisma.InputJsonValue,
          flaws: listingDraft.flaws.map((flaw) => ({
            ...flaw,
            source: flaw.source ?? "ai",
          })) as Prisma.InputJsonValue,
          selectedMarketplaces: ["ebay", "grailed", "poshmark", "depop", "etsy"],
        },
      });
      await tx.aiOutput.create({
        data: {
          inventoryItemId,
          provider: "gemini",
          model: gemini.model,
          kind: "bulk_listing_draft",
          promptVersion: GEMINI_PROMPT_VERSION,
          rawText: gemini.rawText,
          rawJson: gemini.rawJson as Prisma.InputJsonValue,
          validatedJson: gemini.draft as Prisma.InputJsonValue,
        },
      });
      const completed = await tx.bulkItem.updateMany({
        where: { id: item.id, accountId: args.account.id, generationAttempts: item.generationAttempts + 1, status: "generating", inventoryItemId: null },
        data: {
          inventoryItemId,
          status: nextStatus,
          reviewReason,
          errorCode: null,
          errorMessage: null,
          aiProvider: "gemini",
          aiModel: gemini.model,
          generationEndedAt: new Date(),
        },
      });
      if (completed.count !== 1) {
        throw new AppError(
          "Bulk item generation was canceled before conversion.",
          409,
          "BULK_ITEM_CANCELED",
        );
      }
      await tx.jobLog.create({ data: automationJobData({
        id: bulkJobId("prepare", item.id), inventoryItemId,
        accountId: args.account.id, userId: args.user.id,
        policy: { mode: "prepare" },
        warnings: [...gemini.draft.warnings, ...(reviewReason ? [reviewReason] : [])],
      }) });
    });

    await settleUsageReservationOrRequireReconciliation(
      usageReservationId,
      new Date(),
      "BULK_AI_LISTING_SETTLEMENT_FAILED",
      prisma,
    ).catch(async (usageError) => {
      logUnexpectedError("bulk_ai_listing_usage_settlement", usageError);
      await markUsageReconciliationRequired(
        usageReservationId,
        new Date(),
        "BULK_AI_LISTING_SETTLEMENT_FAILED",
        prisma,
      ).catch((markError) =>
        logUnexpectedError("bulk_ai_listing_usage_reconcile", markError),
      );
    });
  } catch (error) {
    if (writeStarted || (providerStarted && error instanceof BulkStepTimeout)) {
      await markUsageReconciliationRequired(usageReservationId, new Date(), "BULK_GENERATION_UNCERTAIN", prisma);
      await prisma.bulkItem.updateMany({
        where: { id: item.id, accountId: args.account.id, generationAttempts: item.generationAttempts + 1, status: "generating", inventoryItemId: null },
        data: { status: "needs_review", errorCode: "BULK_GENERATION_UNCERTAIN", errorMessage: writeStarted ? "Saving could not be confirmed. Review this item before retrying." : "The AI request timed out and its outcome is unknown. Review this item and usage before retrying.", generationEndedAt: new Date() },
      });
      await refreshBulkBatch(args.batchId, prisma);
      return generationResult(args.batchId, item.id, args.account.id, prisma);
    }
    if (usageReservationId) {
      await releaseUsageReservation(
        usageReservationId,
        new Date(),
        prisma,
        "released",
        { allowStartedWork: true },
      ).catch(
        (usageError) => logUnexpectedError("bulk_ai_listing_usage_release", usageError),
      );
    }
    assertBulkItemTransition("generating", "failed");
    await prisma.bulkItem.updateMany({
      where: { id: item.id, accountId: args.account.id, generationAttempts: item.generationAttempts + 1, status: "generating" },
      data: {
        status: "failed",
        errorCode: error instanceof AppError ? (error.code ?? "AI_GENERATION_FAILED") : "AI_GENERATION_FAILED",
        errorMessage: safePersistedFailureReason(
          error,
          "AI listing generation failed. Retry this item.",
        ),
        aiProvider: "gemini",
        generationEndedAt: new Date(),
      },
    });
  }

  await refreshBulkBatch(args.batchId, prisma);
  return generationResult(args.batchId, item.id, args.account.id, prisma);
}

export async function cancelBulkBatch(
  batchId: string,
  accountId: string,
  prisma: Db = getPrisma(),
): Promise<BulkBatchView> {
  const batch = await requireOwnedBulkBatch(batchId, accountId, prisma);
  if (batch.status === "canceled") return toBatchView(batch);

  await prisma.$transaction(async (tx) => {
    await lockBulkBatch(batchId, tx as unknown as Db);
    await tx.bulkItem.updateMany({
      where: {
        batchId,
        OR: [
          {
            status: {
              in: ["uploaded", "grouping", "ready_for_generation", "generating", "failed"],
            },
          },
          { status: "needs_review", inventoryItemId: null },
        ],
      },
      data: { status: "canceled", canceledAt: new Date(), generationEndedAt: new Date() },
    });
    const items = await tx.bulkItem.findMany({
      where: { batchId },
      select: { status: true },
    });
    const summary = summarizeBulkItems(items);
    await tx.bulkBatch.update({
      where: { id: batchId },
      data: { ...summary, status: "canceled", canceledAt: new Date() },
    });
  });
  const canceledItems = await prisma.bulkItem.findMany({
    where: { batchId, accountId, status: "canceled", inventoryItemId: null },
    select: { id: true },
  });
  if (canceledItems.length > 0) {
    const reservations = await prisma.usageReservation.findMany({
      where: {
        accountId,
        operationType: "bulk_listing",
        operationId: { in: canceledItems.map((item) => item.id) },
        status: "reserved",
      },
      select: { id: true, workStartedAt: true },
    });
    for (const reservation of reservations) {
      if (reservation.workStartedAt) {
        await markUsageReconciliationRequired(reservation.id, new Date(), "BULK_GENERATION_CANCELED", prisma)
          .catch((error) => logUnexpectedError("bulk_cancel_usage_reconcile", error));
      } else {
        await releaseUsageReservation(reservation.id, new Date(), prisma, "released")
          .catch((error) => logUnexpectedError("bulk_cancel_usage_release", error));
      }
    }
  }
  return getBulkBatchView(batchId, accountId, prisma);
}
