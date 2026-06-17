-- Persist durable marketplace-visible image derivatives without exposing the
-- original private ItemPhoto objects. Additive only; no existing rows change.

CREATE TYPE "MarketplaceImageStatus" AS ENUM ('READY', 'STALE', 'DELETED', 'FAILED');

CREATE TABLE "MarketplaceImage" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "inventoryItemId" UUID NOT NULL,
  "itemPhotoId" UUID NOT NULL,
  "marketplace" "Marketplace" NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'sandbox',
  "storagePath" TEXT NOT NULL,
  "publicUrl" TEXT NOT NULL,
  "status" "MarketplaceImageStatus" NOT NULL DEFAULT 'READY',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MarketplaceImage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "MarketplaceImage"
  ADD CONSTRAINT "MarketplaceImage_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "MarketplaceImage"
  ADD CONSTRAINT "MarketplaceImage_itemPhotoId_fkey"
  FOREIGN KEY ("itemPhotoId") REFERENCES "ItemPhoto"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "MarketplaceImage_itemPhotoId_marketplace_environment_key"
  ON "MarketplaceImage"("itemPhotoId", "marketplace", "environment");

CREATE INDEX "MarketplaceImage_inventoryItemId_marketplace_environment_status_idx"
  ON "MarketplaceImage"("inventoryItemId", "marketplace", "environment", "status");

ALTER TABLE "MarketplaceImage" ENABLE ROW LEVEL SECURITY;
