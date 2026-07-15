import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

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
  prepareListingPhotos: vi.fn(),
  uploadListingPhotos: vi.fn(),
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
  prepareListingPhotos: mocks.prepareListingPhotos,
  uploadListingPhotos: mocks.uploadListingPhotos,
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServiceClient: () => ({
    storage: {
      from: () => ({ createSignedUrl: mocks.createSignedUrl }),
    },
  }),
}));

import {
  cancelBulkBatch,
  createBulkBatch,
  generateBulkItem,
  groupBulkPhotos,
  registerBulkPhotos,
  recoverStaleBulkGeneration,
  requireOwnedBulkBatch,
} from "./service";

const account = { id: "00000000-0000-4000-8000-000000000001", ownerUserId: "user-1", plan: "free" as const };
const user = { id: "user-1", email: "seller@example.com" };
const now = new Date("2026-07-10T12:00:00.000Z");

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

  it("scopes every batch lookup to the active account and hides unowned ids", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    mocks.getPrisma.mockReturnValue({ bulkBatch: { findFirst } });

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
    mocks.getPrisma.mockReturnValue({ bulkBatch: { findFirst, create } });

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
    mocks.getPrisma.mockReturnValue({ bulkBatch: { findFirst: vi.fn(), create: vi.fn() } });
    await expect(
      createBulkBatch({ account, user, expectedItems: 11 }),
    ).rejects.toMatchObject({ code: "BULK_BATCH_TOO_LARGE" });
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
      bulkPhoto: { updateMany: vi.fn(), update: vi.fn() },
      bulkItem: { deleteMany: vi.fn(), createMany: vi.fn(), updateMany: vi.fn() },
      bulkBatch: { update: vi.fn() },
    };
    const prisma = {
      bulkBatch: { findFirst },
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<void>) => callback(tx)),
    };
    mocks.getPrisma.mockReturnValue(prisma);

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

  it("registers account-scoped photo metadata in deterministic upload order", async () => {
    const before = batchRecord("created");
    const registered = photo("30000000-0000-4000-8000-000000000010", 0);
    const after = batchRecord("uploading", [registered]);
    const findFirst = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const update = vi.fn().mockResolvedValue({ id: before.id });
    const prisma = {
      bulkBatch: { findFirst, update },
      bulkPhoto: { createMany },
      $transaction: vi.fn(async (operations: Promise<unknown>[]) => Promise.all(operations)),
    };
    mocks.getPrisma.mockReturnValue(prisma);
    mocks.prepareListingPhotos.mockResolvedValue([
      {
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: "image/jpeg",
        originalName: "front.jpg",
        position: 0,
      },
    ]);
    mocks.uploadListingPhotos.mockResolvedValue([
      {
        bucket: "private",
        path: "user-1/batch/front.jpg",
        mimeType: "image/jpeg",
        originalName: "front.jpg",
        position: 0,
      },
    ]);
    const formData = new FormData();
    formData.append("photos", new File([new Uint8Array([1])], "front.jpg", { type: "image/jpeg" }));

    const result = await registerBulkPhotos({
      batchId: before.id,
      account,
      user,
      formData,
    });

    expect(result.photoCount).toBe(1);
    expect(createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          batchId: before.id,
          accountId: account.id,
          position: 0,
          storagePath: "user-1/batch/front.jpg",
        }),
      ],
    });
  });

  it("recovers stale generation and expires its reserved usage", async () => {
    const itemId = "20000000-0000-4000-8000-000000000099";
    const now = new Date("2026-07-10T12:00:00Z");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = {
      bulkItem: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: itemId, generationAttempts: 2 }])
          .mockResolvedValueOnce([{ status: "failed" }]),
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
    mocks.getPrisma.mockReturnValue(prisma);

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
          status: "failed",
          errorCode: "BULK_GENERATION_STALE",
        }),
      }),
    );
    expect(mocks.releaseUsageReservation).toHaveBeenCalledWith(
      "reservation-stale",
      now,
      prisma,
      "expired",
      { allowStartedWork: true },
    );
  });

  it("moves quota-exhausted items to review without calling Gemini", async () => {
    const initial = generationItem();
    const final = { ...initial, status: "needs_review", reviewReason: "Upgrade for more.", errorCode: "QUOTA_EXCEEDED_AI_LISTING" };
    const findFirst = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(final);
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
    mocks.getPrisma.mockReturnValue(prisma);
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
    const findFirst = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(final);
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
    mocks.getPrisma.mockReturnValue(prisma);
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

  it("converts a successful item into the normal inventory and listing flow once", async () => {
    const initial = generationItem();
    const final = { ...initial, status: "listing_ready", inventoryItemId: "40000000-0000-4000-8000-000000000001" };
    const findFirst = vi.fn().mockResolvedValueOnce(initial).mockResolvedValueOnce(final);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = {
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
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<void>) => callback(tx)),
    };
    mocks.getPrisma.mockReturnValue(prisma);
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
    expect(tx.aiOutput.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ provider: "gemini" }) }),
    );
    expect(mocks.settleUsageReservationOrRequireReconciliation).toHaveBeenCalledWith(
      "usage-reservation-1",
      expect.any(Date),
      "BULK_AI_LISTING_SETTLEMENT_FAILED",
      prisma,
    );
  });

  it("returns an existing normal inventory conversion idempotently", async () => {
    const converted = {
      ...generationItem("listing_ready"),
      inventoryItemId: "40000000-0000-4000-8000-000000000010",
    };
    const findFirst = vi.fn().mockResolvedValue(converted);
    mocks.getPrisma.mockReturnValue({ bulkItem: { findFirst } });

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
    const unfinished = generationItem();
    const completed = { ...generationItem("listing_ready"), id: "20000000-0000-4000-8000-000000000002", inventoryItemId: "40000000-0000-4000-8000-000000000002" };
    const before = batchRecord("processing", [], [unfinished, completed]);
    const after = { ...batchRecord("canceled", [], [{ ...unfinished, status: "canceled" }, completed]), canceledAt: now };
    const findFirst = vi.fn().mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    const tx = {
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
        findMany: vi.fn().mockResolvedValue([{ id: "canceled-reservation-1" }]),
      },
      $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<void>) => callback(tx)),
    };
    mocks.getPrisma.mockReturnValue(prisma);

    const result = await cancelBulkBatch(before.id, account.id);

    expect(result.status).toBe("canceled");
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
      { allowStartedWork: true },
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
