-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('DRAFTING', 'DRAFT_READY', 'AI_FAILED', 'APPROVED', 'LISTING', 'LISTED', 'SOLD', 'DELISTING', 'DELISTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('sneakers', 'streetwear', 'hype_fashion', 'accessories', 'other');

-- CreateEnum
CREATE TYPE "ItemCondition" AS ENUM ('new_with_tags', 'new_without_tags', 'used_excellent', 'used_good', 'used_fair', 'for_parts', 'unknown');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "Marketplace" AS ENUM ('ebay', 'grailed', 'poshmark', 'depop');

-- CreateEnum
CREATE TYPE "MarketplaceListingStatus" AS ENUM ('NOT_LISTED', 'QUEUED', 'LISTING', 'LISTED', 'SOLD', 'DELISTING', 'DELISTED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" UUID NOT NULL,
    "sellerId" UUID NOT NULL,
    "status" "InventoryStatus" NOT NULL DEFAULT 'DRAFTING',
    "productName" TEXT NOT NULL,
    "brand" TEXT,
    "category" "ProductCategory" NOT NULL DEFAULT 'other',
    "condition" "ItemCondition" NOT NULL DEFAULT 'unknown',
    "styleCode" TEXT,
    "colorway" TEXT,
    "size" TEXT,
    "confidence" DOUBLE PRECISION,
    "recommendedPriceCents" INTEGER,
    "pricingRationale" TEXT,
    "soldAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemPhoto" (
    "id" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "storageBucket" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ItemPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiOutput" (
    "id" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "rawText" TEXT,
    "rawJson" JSONB,
    "validatedJson" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiOutput_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingDraft" (
    "id" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "bulletPoints" TEXT[],
    "recommendedPriceCents" INTEGER,
    "pricingRationale" TEXT,
    "itemSpecifics" JSONB NOT NULL,
    "marketplaceDrafts" JSONB NOT NULL,
    "selectedMarketplaces" "Marketplace"[] DEFAULT ARRAY[]::"Marketplace"[],
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketplaceListing" (
    "id" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "status" "MarketplaceListingStatus" NOT NULL DEFAULT 'NOT_LISTED',
    "externalListingId" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobLog" (
    "id" UUID NOT NULL,
    "inventoryItemId" UUID,
    "queueName" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL,
    "payload" JSONB NOT NULL,
    "result" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JobLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryItem_sellerId_status_idx" ON "InventoryItem"("sellerId", "status");

-- CreateIndex
CREATE INDEX "InventoryItem_createdAt_idx" ON "InventoryItem"("createdAt");

-- CreateIndex
CREATE INDEX "ItemPhoto_inventoryItemId_idx" ON "ItemPhoto"("inventoryItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemPhoto_storageBucket_storagePath_key" ON "ItemPhoto"("storageBucket", "storagePath");

-- CreateIndex
CREATE INDEX "AiOutput_inventoryItemId_createdAt_idx" ON "AiOutput"("inventoryItemId", "createdAt");

-- CreateIndex
CREATE INDEX "ListingDraft_inventoryItemId_status_idx" ON "ListingDraft"("inventoryItemId", "status");

-- CreateIndex
CREATE INDEX "MarketplaceListing_marketplace_status_idx" ON "MarketplaceListing"("marketplace", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MarketplaceListing_inventoryItemId_marketplace_key" ON "MarketplaceListing"("inventoryItemId", "marketplace");

-- CreateIndex
CREATE INDEX "JobLog_inventoryItemId_idx" ON "JobLog"("inventoryItemId");

-- CreateIndex
CREATE INDEX "JobLog_queueName_status_idx" ON "JobLog"("queueName", "status");

-- AddForeignKey
ALTER TABLE "ItemPhoto" ADD CONSTRAINT "ItemPhoto_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiOutput" ADD CONSTRAINT "AiOutput_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingDraft" ADD CONSTRAINT "ListingDraft_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketplaceListing" ADD CONSTRAINT "MarketplaceListing_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobLog" ADD CONSTRAINT "JobLog_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Enable RLS on application tables. The MVP accesses these tables through
-- trusted server-side Prisma connections, not directly from the browser.
ALTER TABLE "InventoryItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ItemPhoto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiOutput" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ListingDraft" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketplaceListing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "JobLog" ENABLE ROW LEVEL SECURITY;

-- Storage bucket used for listing photo uploads.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'listing-photos',
    'listing-photos',
    false,
    8388608,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE
SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;
