-- Durable, account-scoped bulk photo intake. This is additive and stops at
-- editable listing creation: it does not publish, delist, or call marketplaces.

CREATE TYPE "BulkBatchStatus" AS ENUM (
  'created',
  'uploading',
  'processing',
  'needs_review',
  'ready',
  'partially_failed',
  'failed',
  'canceled'
);

CREATE TYPE "BulkItemStatus" AS ENUM (
  'uploaded',
  'grouping',
  'ready_for_generation',
  'generating',
  'needs_review',
  'listing_ready',
  'failed',
  'canceled'
);

CREATE TABLE "BulkBatch" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "idempotencyKey" TEXT,
  "status" "BulkBatchStatus" NOT NULL DEFAULT 'created',
  "photoCount" INTEGER NOT NULL DEFAULT 0,
  "totalItems" INTEGER NOT NULL DEFAULT 0,
  "processedItems" INTEGER NOT NULL DEFAULT 0,
  "needsReviewItems" INTEGER NOT NULL DEFAULT 0,
  "listingReadyItems" INTEGER NOT NULL DEFAULT 0,
  "failedItems" INTEGER NOT NULL DEFAULT 0,
  "canceledItems" INTEGER NOT NULL DEFAULT 0,
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BulkBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BulkItem" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batchId" UUID NOT NULL,
  "inventoryItemId" UUID,
  "position" INTEGER NOT NULL,
  "status" "BulkItemStatus" NOT NULL DEFAULT 'uploaded',
  "reviewReason" TEXT,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "generationAttempts" INTEGER NOT NULL DEFAULT 0,
  "aiProvider" TEXT,
  "aiModel" TEXT,
  "generationStartedAt" TIMESTAMP(3),
  "generationEndedAt" TIMESTAMP(3),
  "canceledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BulkItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BulkPhoto" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "batchId" UUID NOT NULL,
  "bulkItemId" UUID,
  "storageBucket" TEXT NOT NULL,
  "storagePath" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "position" INTEGER NOT NULL,
  "itemPosition" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BulkPhoto_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BulkBatch_accountId_idempotencyKey_key" ON "BulkBatch"("accountId", "idempotencyKey");
CREATE INDEX "BulkBatch_accountId_createdAt_idx" ON "BulkBatch"("accountId", "createdAt");
CREATE INDEX "BulkBatch_accountId_status_updatedAt_idx" ON "BulkBatch"("accountId", "status", "updatedAt");
CREATE INDEX "BulkBatch_createdByUserId_createdAt_idx" ON "BulkBatch"("createdByUserId", "createdAt");
CREATE UNIQUE INDEX "BulkItem_inventoryItemId_key" ON "BulkItem"("inventoryItemId");
CREATE UNIQUE INDEX "BulkItem_batchId_position_key" ON "BulkItem"("batchId", "position");
CREATE INDEX "BulkItem_batchId_status_position_idx" ON "BulkItem"("batchId", "status", "position");
CREATE UNIQUE INDEX "BulkPhoto_storageBucket_storagePath_key" ON "BulkPhoto"("storageBucket", "storagePath");
CREATE UNIQUE INDEX "BulkPhoto_batchId_position_key" ON "BulkPhoto"("batchId", "position");
CREATE INDEX "BulkPhoto_batchId_bulkItemId_itemPosition_idx" ON "BulkPhoto"("batchId", "bulkItemId", "itemPosition");

ALTER TABLE "BulkBatch" ADD CONSTRAINT "BulkBatch_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BulkItem" ADD CONSTRAINT "BulkItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BulkBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BulkItem" ADD CONSTRAINT "BulkItem_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BulkPhoto" ADD CONSTRAINT "BulkPhoto_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "BulkBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BulkPhoto" ADD CONSTRAINT "BulkPhoto_bulkItemId_fkey" FOREIGN KEY ("bulkItemId") REFERENCES "BulkItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Uniform deny-all browser posture; the trusted application role bypasses RLS.
ALTER TABLE "BulkBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BulkItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BulkPhoto" ENABLE ROW LEVEL SECURITY;
