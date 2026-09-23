import { bulkJobId } from "./job-id";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "signed-photo" } }),
  downloadListingPhotos: vi.fn(),
  generateListingDraftWithGemini: vi.fn(),
  getPrisma: vi.fn(),
  markUsageReconciliationRequired: vi.fn(),
  markUsageWorkStarted: vi.fn(),
  releaseUsageReservation: vi.fn(),
  reserveUsageOrThrow: vi.fn(),
  settleUsageReservationOrRequireReconciliation: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  storageInfo: vi.fn(),
  storageRemove: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/ai/gemini", () => ({
  GEMINI_PROMPT_VERSION: "test-prompt",
  generateListingDraftWithGemini: mocks.generateListingDraftWithGemini,
}));
vi.mock("@/lib/billing/usage", () => ({
  markUsageReconciliationRequired: mocks.markUsageReconciliationRequired,
  markUsageWorkStarted: mocks.markUsageWorkStarted,
  releaseUsageReservation: mocks.releaseUsageReservation,
  reserveUsageOrThrow: mocks.reserveUsageOrThrow,
  settleUsageReservationOrRequireReconciliation:
    mocks.settleUsageReservationOrRequireReconciliation,
}));
vi.mock("@/lib/storage/listing-photos", () => ({
  downloadListingPhotos: mocks.downloadListingPhotos,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({
    storage: {
      from: () => ({
        createSignedUrl: mocks.createSignedUrl,
        createSignedUploadUrl: mocks.createSignedUploadUrl,
        info: mocks.storageInfo,
        remove: mocks.storageRemove,
      }),
    },
  }),
}));

import {
  cancelBulkBatch,
  createBulkPhotoUploadGrants,
  createBulkBatch,
  generateBulkItem,
  groupBulkPhotos,
  registerBulkPhotos,
  recoverStaleBulkGeneration,
  requireOwnedBulkBatch,
} from "./service";

function usePrisma<T extends object>(value: T) {
  const db = value as T & { $executeRawUnsafe?: unknown; $transaction?: (callback: (tx: object) => unknown) => unknown };
  db.$executeRawUnsafe ??= vi.fn();
  const transaction = db.$transaction ?? (async (callback: (tx: object) => unknown) => callback(db));
  db.$transaction = vi.fn((callback: (tx: object) => unknown) => transaction((tx: object) => {
    const merged = { ...db, ...tx } as Record<string, unknown>;
    for (const key of Object.keys(tx)) {
      const original = (db as Record<string, unknown>)[key];
      const override = (tx as Record<string, unknown>)[key];
      if (original && override && typeof original === "object" && typeof override === "object") merged[key] = { ...original, ...override };
    }
    return callback(merged);
  }));
  mocks.getPrisma.mockReturnValue(db);
}

const account = { id: "00000000-0000-4000-8000-000000000001", ownerUserId: "user-1", plan: "free" as const };
const user = { id: "user-1", email: "seller@example.com" };
const now = new Date("2026-07-10T12:00:00.000Z");

function validJpeg() {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    0x00, 0x64,
    0x00, 0x64,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

function photo(id: string, position: number, bulkItemId: string | null = null) {
  return {
    id,
    batchId: "10000000-0000-4000-8000-000000000001",
    accountId: account.id,
    bulkItemId,
    storageBucket: "private",
    storagePath: `user-1/batch/${id}.jpg`,
    mimeType: "image/jpeg",
    originalName: `${id}.jpg`,
    position,
    itemPosition: bulkItemId ? position : null,
    createdAt: now,
  };
}

function batchRecord(
  status = "created",
  photos: ReturnType<typeof photo>[] = [],
  items: Array<Record<string, unknown>> = [],
) {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    accountId: account.id,
    createdByUserId: user.id,
    idempotencyKey: null,
    status,
    photoCount: photos.length,
    totalItems: items.length,
    processedItems: 0,
    needsReviewItems: 0,
    listingReadyItems: 0,
    failedItems: 0,
    canceledItems: 0,
    canceledAt: null,
    createdAt: now,
    updatedAt: now,
    photos,
    items,
  };
}

function generationItem(status = "ready_for_generation") {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    batchId: "10000000-0000-4000-8000-000000000001",
    accountId: account.id,
    inventoryItemId: null,
    position: 0,
    status,
    reviewReason: null,
    errorCode: null,
    errorMessage: null,
    generationAttempts: 0,
    aiProvider: null,
    aiModel: null,
    generationStartedAt: null,
    generationEndedAt: null,
    canceledAt: null,
    createdAt: now,
    updatedAt: now,
    batch: { status: "needs_review" },
    photos: [photo("30000000-0000-4000-8000-000000000001", 0)],
  };
}

describe("bulk intake service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BULK_INTAKE_ENABLED", "true");
    vi.stubEnv("SUPABASE_STORAGE_BUCKET", "private");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(validJpeg(), { status: 206 })),
    );
    mocks.createSignedUploadUrl.mockImplementation(async (path: string) => ({
      data: { path, token: "upload-token", signedUrl: "https://storage.test/upload" },
      error: null,
    }));
    mocks.storageInfo.mockResolvedValue({
      data: { size: 1, contentType: "image/jpeg" },
      error: null,
    });
    mocks.storageRemove.mockResolvedValue({ data: [], error: null });
    mocks.reserveUsageOrThrow.mockResolvedValue({
      allowed: true,
      reservationId: "usage-reservation-1",
      idempotent: false,
      status: "reserved",
    });
    mocks.releaseUsageReservation.mockResolvedValue(true);
    mocks.markUsageWorkStarted.mockResolvedValue(true);
    mocks.markUsageReconciliationRequired.mockResolvedValue(true);
    mocks.settleUsageReservationOrRequireReconciliation.mockResolvedValue("settled");
    mocks.downloadListingPhotos.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("scopes every batch lookup to the active account and hides unowned ids", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    usePrisma({ bulkBatch: { findFirst } });

    await expect(
      requireOwnedBulkBatch("10000000-0000-4000-8000-000000000001", account.id),
    ).rejects.toMatchObject({ status: 404, code: "BULK_BATCH_NOT_FOUND" });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "10000000-0000-4000-8000-000000000001",
          accountId: account.id,
        },
      }),
    );
  });

  it("creates a durable account batch and returns the existing idempotent batch", async () => {
    const existing = { ...batchRecord(), idempotencyKey: "bulk-request-123" };
    const findFirst = vi.fn().mockResolvedValue(existing);
    const create = vi.fn();
    usePrisma({ bulkBatch: { findFirst, create } });

    const result = await createBulkBatch({
      account,
      user,
      idempotencyKey: "bulk-request-123",
      expectedItems: 5,
    });

    expect(result.id).toBe(existing.id);
    expect(create).not.toHaveBeenCalled();
  });

  it("enforces the plan item cap before creating a batch", async () => {
    usePrisma({ bulkBatch: { findFirst: vi.fn(), create: vi.fn() } });
    await expect(
      createBulkBatch({ account, user, expectedItems: 11 }),
    ).rejects.toMatchObject({ code: "BULK_BATCH_TOO_LARGE" });
  });

  it("blocks new batch creation when the kill switch is not explicitly enabled", async () => {
    vi.stubEnv("BULK_INTAKE_ENABLED", "");
    const create = vi.fn();
    usePrisma({ bulkBatch: { create } });

    await expect(createBulkBatch({ account, user, expectedItems: 1 })).rejects.toMatchObject({
      status: 503,
      code: "BULK_INTAKE_DISABLED",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("still returns an existing idempotent batch while the kill switch is off", async () => {
    vi.stubEnv("BULK_INTAKE_ENABLED", "");
    const existing = { ...batchRecord(), idempotencyKey: "bulk-request-recovery" };
    const create = vi.fn();
    usePrisma({
      bulkBatch: { findFirst: vi.fn().mockResolvedValue(existing), create },
    });

    await expect(
      createBulkBatch({ account, user, idempotencyKey: "bulk-request-recovery" }),
    ).resolves.toMatchObject({ id: existing.id });
    expect(create).not.toHaveBeenCalled();
  });

  it("persists complete photo grouping and the grouping-to-ready transition", async () => {
    const photoA = photo("30000000-0000-4000-8000-000000000001", 0);
    const photoB = photo("30000000-0000-4000-8000-000000000002", 1);
    const before = batchRecord("uploading", [photoA, photoB]);
    const groupedItem = {
      ...generationItem(),
      id: "20000000-0000-4000-8000-000000000099",
      photos: [
        { ...photoA, bulkItemId: "20000000-0000-4000-8000-000000000099", itemPosition: 0 },
        { ...photoB, bulkItemId: "20000000-0000-4000-8000-000000000099", itemPosition: 1 },
      ],
    };
    const after = batchRecord("needs_review", groupedItem.photos, [groupedItem]);
    const findFirst = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const tx = {
      $executeRawUnsafe: vi.fn(),
      bulkPhoto: { updateMany: vi.fn(), update: vi.fn() },
      bulkItem: { deleteMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
      bulkBatch: { update: vi.fn(), findFirst },
    };
    const prisma = {
      bulkBatch: { findFirst },
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<void>) => callback(tx)),
    };
    usePrisma(prisma);

    const result = await groupBulkPhotos({
      batchId: before.id,
      account,
      user,
      groups: [{ photoIds: [photoA.id, photoB.id] }],
    });

    expect(tx.bulkItem.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ status: "uploaded", position: 0 })],
      }),
    );
    expect(tx.bulkItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "uploaded" }),
        data: { status: "grouping" },
      }),
    );
    expect(tx.bulkItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "ready_for_generation" } }),
    );
    expect(result.status).toBe("needs_review");
  });

  it("creates account-and-batch-scoped signed upload grants", async () => {
    const before = batchRecord("created");
    usePrisma({
      bulkBatch: { findFirst: vi.fn().mockResolvedValue(before) },
    });
    const uploadId = "30000000-0000-4000-8000-000000000010";

    const grants = await createBulkPhotoUploadGrants({
      batchId: before.id,
      account,
      user,
      photos: [
        {
          uploadId,
          originalName: "front.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 1,
        },
      ],
    });

    expect(grants).toEqual([
      {
        uploadId,
        bucket: "private",
        path: `bulk/${account.id}/${before.id}/${uploadId}.jpg`,
        token: "upload-token",
      },
    ]);
    expect(mocks.createSignedUploadUrl).toHaveBeenCalledWith(grants[0]?.path, {
      upsert: false,
    });
  });

  it("registers account-scoped photo metadata in deterministic upload order", async () => {
    const before = batchRecord("created");
    const registered = photo("30000000-0000-4000-8000-000000000010", 0);
    registered.storagePath = `bulk/${account.id}/${before.id}/${registered.id}.jpg`;
    const after = batchRecord("uploading", [registered]);
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const update = vi.fn().mockResolvedValue({ id: before.id });
    const transaction = {
      bulkBatch: { findFirst, update },
      bulkPhoto: { createMany },
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    };
    const prisma = {
      bulkBatch: { findFirst, update },
      bulkPhoto: { createMany },
      $transaction: vi.fn(async (callback: (value: typeof transaction) => Promise<void>) =>
        callback(transaction),
      ),
    };
    usePrisma(prisma);

    const result = await registerBulkPhotos({
      batchId: before.id,
      account,
      user,
      photos: [
        {
          uploadId: registered.id,
          originalName: "front.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 1,
          storagePath: registered.storagePath,
        },
      ],
    });

    expect(result.photoCount).toBe(1);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          batchId: before.id,
          accountId: account.id,
          position: 0,
          storagePath: registered.storagePath,
        }),
      ],
    });
  });

  it("replays photo metadata registration without duplicate rows or count increments", async () => {
    const registered = photo("30000000-0000-4000-8000-000000000010", 0);
    registered.storagePath = `bulk/${account.id}/${batchRecord().id}/${registered.id}.jpg`;
    const existing = batchRecord("uploading", [registered]);
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing)
      .mockResolvedValueOnce(existing);
    const createMany = vi.fn();
    const update = vi.fn();
    const transaction = {
      bulkBatch: { findFirst, update },
      bulkPhoto: { createMany },
      $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    };
    usePrisma({
      bulkBatch: { findFirst, update },
      bulkPhoto: { createMany },
      $transaction: vi.fn(async (callback: (value: typeof transaction) => Promise<void>) =>
        callback(transaction),
      ),
    });

    const result = await registerBulkPhotos({
      batchId: existing.id,
      account,
      user,
      photos: [
        {
          uploadId: registered.id,
          originalName: registered.originalName,
          mimeType: "image/jpeg",
          sizeBytes: 1,
          storagePath: registered.storagePath,
        },
      ],
    });

    expect(result.photoCount).toBe(1);
    expect(createMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(mocks.storageInfo).not.toHaveBeenCalled();
  });

  it("rejects a storage path outside the authenticated account and batch", async () => {
    const before = batchRecord("created");
    usePrisma({
      bulkBatch: { findFirst: vi.fn().mockResolvedValue(before) },
    });

    await expect(
      registerBulkPhotos({
        batchId: before.id,
        account,
        user,
        photos: [
          {
            uploadId: "30000000-0000-4000-8000-000000000010",
            originalName: "front.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 1,
            storagePath: "bulk/another-account/another-batch/front.jpg",
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 400, code: "BULK_PHOTO_PATH_INVALID" });
    expect(mocks.storageInfo).not.toHaveBeenCalled();
  });

  it("removes an unregistered object that fails server-side validation", async () => {
    const before = batchRecord("created");
    usePrisma({
      bulkBatch: { findFirst: vi.fn().mockResolvedValue(before) },
    });
    mocks.storageInfo.mockResolvedValue({
      data: { size: 99, contentType: "image/jpeg" },
      error: null,
    });
    const uploadId = "30000000-0000-4000-8000-000000000010";
    const storagePath = `bulk/${account.id}/${before.id}/${uploadId}.jpg`;

    await expect(
      registerBulkPhotos({
        batchId: before.id,
        account,
        user,
        photos: [
          {
            uploadId,
            originalName: "front.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 1,
            storagePath,
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 400, code: "BULK_PHOTO_INVALID" });
    expect(mocks.storageRemove).toHaveBeenCalledWith([storagePath]);
  });

  it("blocks new item generation while the kill switch is off", async () => {
    vi.stubEnv("BULK_INTAKE_ENABLED", "");
    const updateMany = vi.fn();
    usePrisma({
      bulkItem: {
        findFirst: vi.fn().mockResolvedValue(generationItem()),
        updateMany,
      },
    });

    await expect(
      generateBulkItem({
        batchId: batchRecord().id,
        itemId: generationItem().id,
        account,
        user,
      }),
    ).rejects.toMatchObject({ status: 503, code: "BULK_INTAKE_DISABLED" });
    expect(updateMany).not.toHaveBeenCalled();
    expect(mocks.reserveUsageOrThrow).not.toHaveBeenCalled();
  });

  it("parks stale generation for review and reconciles its reserved usage", async () => {
    vi.stubEnv("BULK_INTAKE_ENABLED", "");
    const itemId = "20000000-0000-4000-8000-000000000099";
    const now = new Date("2026-07-10T12:00:00Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      bulkItem: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: itemId, generationAttempts: 2 }])
          .mockResolvedValueOnce([{ status: "needs_review" }]),
        updateMany,
      },
      bulkBatch: {
        findUnique: vi.fn().mockResolvedValue({ status: "processing" }),
        update: vi.fn().mockResolvedValue({ id: batchRecord().id }),
      },
      usageReservation: {
        findUnique: vi.fn().mockResolvedValue({ id: "reservation-stale", status: "reserved" }),
      },
    };
    usePrisma(prisma);

    await expect(
      recoverStaleBulkGeneration(batchRecord().id, account.id, now),
    ).resolves.toBe(1);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: itemId,
          accountId: account.id,
          status: "generating",
          generationAttempts: 2,
        }),
        data: expect.objectContaining({
          status: "needs_review",
          errorCode: "BULK_GENERATION_STALE",
        }),
      }),
    );
    expect(mocks.markUsageReconciliationRequired).toHaveBeenCalledWith(
      "reservation-stale", now, "BULK_GENERATION_STALE", prisma,
    );
    expect(mocks.releaseUsageReservation).not.toHaveBeenCalled();
  });

  it("does not reserve or call Gemini if cancellation wins immediately after the claim", async () => {
    const initial = generationItem();
    const canceled = { ...initial, status: "canceled" };
    const findFirst = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(null).mockResolvedValue(canceled);
    const lock = vi.fn();
    const prisma = { $executeRawUnsafe: lock, bulkItem: { findFirst, updateMany: vi.fn().mockResolvedValue({ count: 1 }) }, bulkBatch: { update: vi.fn() } };
    usePrisma(prisma);
    const result = await generateBulkItem({ batchId: initial.batchId, itemId: initial.id, account, user });
    expect(result.status).toBe("canceled");
    expect(lock).toHaveBeenCalledWith(expect.any(String), `bulk-generation:${initial.batchId}`);
    expect(mocks.reserveUsageOrThrow).not.toHaveBeenCalled();
    expect(mocks.generateListingDraftWithGemini).not.toHaveBeenCalled();
  });

  it("rechecks cancellation under the batch lock after downloading photos", async () => {
    const initial = generationItem();
    const canceled = { ...initial, status: "canceled" };
    const findFirst = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce({ id: initial.id }).mockResolvedValueOnce(null).mockResolvedValue(canceled);
    const lock = vi.fn();
    const prisma = {
      $executeRawUnsafe: lock,
      bulkItem: { findFirst, updateMany: vi.fn().mockResolvedValue({ count: 1 }), findMany: vi.fn().mockResolvedValue([{ status: "canceled" }]) },
      bulkBatch: { update: vi.fn(), findUnique: vi.fn().mockResolvedValue({ status: "canceled" }) },
    };
    usePrisma(prisma);
    const result = await generateBulkItem({ batchId: initial.batchId, itemId: initial.id, account, user });
    expect(result.status).toBe("canceled");
    expect(lock).toHaveBeenCalledTimes(3); // claim, provider-start guard, summary
    expect(mocks.markUsageWorkStarted).not.toHaveBeenCalled();
    expect(mocks.generateListingDraftWithGemini).not.toHaveBeenCalled();
    expect(mocks.releaseUsageReservation).toHaveBeenCalled();
    expect(prisma.bulkBatch.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "canceled" }) }));
  });

  it("moves quota-exhausted items to review without calling Gemini", async () => {
    const initial = generationItem();
    const final = { ...initial, status: "needs_review", reviewReason: "Upgrade for more.", errorCode: "QUOTA_EXCEEDED_AI_LISTING" };
    const findFirst = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(final);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      bulkItem: {
        findFirst,
        updateMany,
        findMany: vi.fn().mockResolvedValue([{ status: "needs_review" }]),
      },
      bulkBatch: {
        update: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ status: "processing" }),
      },
    };
    usePrisma(prisma);
    mocks.reserveUsageOrThrow.mockRejectedValue(
      new AppError("Upgrade for more.", 402, "QUOTA_EXCEEDED_AI_LISTING"),
    );

    const result = await generateBulkItem({
      batchId: initial.batchId,
      itemId: initial.id,
      account,
      user,
    });

    expect(result.status).toBe("needs_review");
    expect(result.errorCode).toBe("QUOTA_EXCEEDED_AI_LISTING");
    expect(mocks.generateListingDraftWithGemini).not.toHaveBeenCalled();
  });

  it("isolates an AI failure to the item and persists only a safe retry message", async () => {
    const initial = generationItem();
    const final = { ...initial, status: "failed", errorCode: "AI_GENERATION_FAILED", errorMessage: "AI listing generation failed. Retry this item." };
    const findFirst = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(final);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      bulkItem: {
        findFirst,
        updateMany,
        findMany: vi.fn().mockResolvedValue([{ status: "failed" }]),
      },
      bulkBatch: {
        update: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ status: "processing" }),
      },
    };
    usePrisma(prisma);
    mocks.generateListingDraftWithGemini.mockRejectedValue(
      new Error("provider secret-token raw payload"),
    );

    const result = await generateBulkItem({
      batchId: initial.batchId,
      itemId: initial.id,
      account,
      user,
    });

    expect(result).toMatchObject({ status: "failed", errorCode: "AI_GENERATION_FAILED" });
    const failureWrite = updateMany.mock.calls.find(
      ([call]) => call.data?.status === "failed",
    )?.[0];
    expect(failureWrite.data.errorMessage).toBe(
      "AI listing generation failed. Retry this item.",
    );
    expect(JSON.stringify(failureWrite)).not.toContain("secret-token");
  });

  it.each(["confirmed", "uncertain"])("creates one prepare-only job with the listing when the transaction is %s", async (outcome) => {
    const initial = generationItem();
    const final = { ...initial, status: "listing_ready", inventoryItemId: "40000000-0000-4000-8000-000000000001" };
    const findFirst = vi.fn().mockResolvedValueOnce(initial).mockResolvedValue(final);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
      jobLog: { create: vi.fn() },
      inventoryItem: { create: vi.fn() },
      itemPhoto: { createMany: vi.fn() },
      listingDraft: { create: vi.fn() },
      aiOutput: { create: vi.fn() },
      bulkItem: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const prisma = {
      bulkItem: {
        findFirst,
        updateMany,
        findMany: vi.fn().mockResolvedValue([{ status: "listing_ready" }]),
      },
      bulkBatch: {
        update: vi.fn(),
        findUnique: vi.fn().mockResolvedValue({ status: "processing" }),
      },
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<void>) => {
        const createsBefore = tx.inventoryItem.create.mock.calls.length;
        const result = await callback(tx);
        if (outcome === "uncertain" && tx.inventoryItem.create.mock.calls.length > createsBefore) throw new Error("Commit acknowledgement lost");
        return result;
      }),
    };
    usePrisma(prisma);
    mocks.generateListingDraftWithGemini.mockResolvedValue({
      model: "gemini-test",
      rawText: "{}",
      rawJson: {},
      draft: {
        identification: {
          productName: "Nike Dunk Low Panda",
          brand: "Nike",
          category: "sneakers",
          condition: "used_good",
          styleCode: "DD1391-100",
          colorway: "Panda",
          size: "10",
          confidence: 0.98,
          identifiers: [],
          authenticationNotes: [],
        },
        listingDraft: {
          title: "Nike Dunk Low Panda Size 10",
          description: "Pre-owned Nike Dunk Low Panda sneakers in used good condition.",
          bulletPoints: ["Size 10", "Black and white", "Pre-owned"],
          recommendedPriceCents: null,
          pricingRationale: "Use live sold comps before publishing this listing.",
          itemSpecifics: {},
          compSearchQueries: ["Nike Dunk Low Panda size 10 sold"],
          measurements: [],
          flaws: [],
        },
        marketplaceDrafts: {
          ebay: { title: "Nike Dunk Low Panda Size 10", description: "Pre-owned Nike Dunk Low Panda sneakers.", categoryHint: "Sneakers", tags: ["Nike"] },
          grailed: { title: "Nike Dunk Low Panda Size 10", description: "Pre-owned Nike Dunk Low Panda sneakers.", categoryHint: "Sneakers", tags: ["Nike"] },
          poshmark: { title: "Nike Dunk Low Panda Size 10", description: "Pre-owned Nike Dunk Low Panda sneakers.", categoryHint: "Sneakers", tags: ["Nike"] },
          depop: { title: "Nike Dunk Low Panda Size 10", description: "Pre-owned Nike Dunk Low Panda sneakers.", categoryHint: "Sneakers", tags: ["Nike"] },
          etsy: { title: "Nike Dunk Low Panda Size 10", description: "Pre-owned Nike Dunk Low Panda sneakers.", categoryHint: "Sneakers", tags: ["Nike"] },
        },
        warnings: [],
      },
    });

    const result = await generateBulkItem({
      batchId: initial.batchId,
      itemId: initial.id,
      account,
      user,
    });

    expect(result.status).toBe("listing_ready");
    expect(tx.inventoryItem.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ accountId: account.id }) }),
    );
    expect(tx.listingDraft.create).toHaveBeenCalledOnce();
    expect(tx.jobLog.create).toHaveBeenCalledOnce();
    expect(tx.jobLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      id: bulkJobId("prepare", initial.id), queueName: "listing-automation-v1",
      payload: expect.objectContaining({ accountId: account.id, userId: user.id, policy: { mode: "prepare" } }),
    }) });
    expect(tx.aiOutput.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ provider: "gemini" }) }),
    );
    if (outcome === "confirmed") {
      expect(mocks.settleUsageReservationOrRequireReconciliation).toHaveBeenCalledWith(
        "usage-reservation-1", expect.any(Date), "BULK_AI_LISTING_SETTLEMENT_FAILED", prisma,
      );
    } else {
      expect(mocks.settleUsageReservationOrRequireReconciliation).not.toHaveBeenCalled();
      expect(mocks.releaseUsageReservation).not.toHaveBeenCalled();
      expect(mocks.markUsageReconciliationRequired).toHaveBeenCalledWith(
        "usage-reservation-1", expect.any(Date), "BULK_GENERATION_UNCERTAIN", prisma,
      );
      expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ generationAttempts: initial.generationAttempts + 1, inventoryItemId: null }),
        data: expect.objectContaining({ errorCode: "BULK_GENERATION_UNCERTAIN", status: "needs_review" }),
      }));
    }
  });

  it("does not replay a queued attempt after another attempt already started", async () => {
    const initial = { ...generationItem("failed"), generationAttempts: 2 };
    const findFirst = vi.fn().mockResolvedValue(initial);
    const updateMany = vi.fn();
    usePrisma({ bulkItem: { findFirst, updateMany } });
    await generateBulkItem({ batchId: initial.batchId, itemId: initial.id, account, user, expectedAttempts: 1 });
    expect(updateMany).not.toHaveBeenCalled();
    expect(mocks.reserveUsageOrThrow).not.toHaveBeenCalled();
    expect(mocks.generateListingDraftWithGemini).not.toHaveBeenCalled();
  });

  it("refuses a new generation attempt when interrupted work needs reconciliation", async () => {
    const initial = { ...generationItem("needs_review"), errorCode: "BULK_GENERATION_STALE" };
    usePrisma({ bulkItem: { findFirst: vi.fn().mockResolvedValue(initial) } });
    await expect(generateBulkItem({ batchId: initial.batchId, itemId: initial.id, account, user }))
      .rejects.toMatchObject({ code: "BULK_GENERATION_REVIEW_REQUIRED" });
    expect(mocks.generateListingDraftWithGemini).not.toHaveBeenCalled();
  });

  it("returns an existing normal inventory conversion idempotently", async () => {
    const converted = {
      ...generationItem("listing_ready"),
      inventoryItemId: "40000000-0000-4000-8000-000000000010",
    };
    const findFirst = vi.fn().mockResolvedValue(converted);
    usePrisma({ bulkItem: { findFirst } });

    const result = await generateBulkItem({
      batchId: converted.batchId,
      itemId: converted.id,
      account,
      user,
    });

    expect(result).toMatchObject({
      status: "listing_ready",
      inventoryItemId: converted.inventoryItemId,
    });
    expect(mocks.reserveUsageOrThrow).not.toHaveBeenCalled();
    expect(mocks.generateListingDraftWithGemini).not.toHaveBeenCalled();
  });

  it("cancels unfinished items without deleting completed listings", async () => {
    vi.stubEnv("BULK_INTAKE_ENABLED", "");
    const unfinished = generationItem();
    const completed = { ...generationItem("listing_ready"), id: "20000000-0000-4000-8000-000000000002", inventoryItemId: "40000000-0000-4000-8000-000000000002" };
    const before = batchRecord("processing", [], [unfinished, completed]);
    const after = { ...batchRecord("canceled", [], [{ ...unfinished, status: "canceled" }, completed]), canceledAt: now };
    const findFirst = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const tx = {
      $executeRawUnsafe: vi.fn(),
      bulkItem: {
        updateMany: vi.fn(),
        findMany: vi.fn().mockResolvedValue([{ status: "canceled" }, { status: "listing_ready" }]),
      },
      bulkBatch: { update: vi.fn() },
    };
    const prisma = {
      bulkBatch: { findFirst },
      bulkItem: {
        findMany: vi.fn().mockResolvedValue([{ id: unfinished.id }]),
      },
      usageReservation: {
        findMany: vi.fn().mockResolvedValue([{ id: "canceled-reservation-1", workStartedAt: null }, { id: "started-reservation", workStartedAt: now }]),
      },
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<void>) => callback(tx)),
    };
    usePrisma(prisma);

    const result = await cancelBulkBatch(before.id, account.id);

    expect(result.status).toBe("canceled");
    expect(mocks.markUsageReconciliationRequired).toHaveBeenCalledWith("started-reservation", expect.any(Date), "BULK_GENERATION_CANCELED", prisma);
    expect(tx.bulkItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ batchId: before.id }),
      }),
    );
    expect(JSON.stringify(tx.bulkItem.updateMany.mock.calls[0]?.[0])).not.toContain(
      "listing_ready\"",
    );
    expect(mocks.releaseUsageReservation).toHaveBeenCalledWith(
      "canceled-reservation-1",
      expect.any(Date),
      prisma,
      "released",
    );
  });

  it("does not depend on marketplace publish or delist execution", () => {
    const source = readFileSync(
      join(process.cwd(), "src/lib/bulk-intake/service.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/executePublish|executeBulkPublish|queueDelist|executeDelist/);
    expect(source).not.toMatch(/marketplace\/adapters/);
  });
});
