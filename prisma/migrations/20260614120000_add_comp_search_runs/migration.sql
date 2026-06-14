-- Persist automatic comp discovery runs separately from individual PriceComp rows.
-- Additive only: manual PriceComp v2 rows and pricing behavior are unchanged.

CREATE TABLE "CompSearchRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "inventoryItemId" UUID NOT NULL,
  "status" TEXT NOT NULL,
  "autoDiscoveryEnabled" BOOLEAN NOT NULL DEFAULT false,
  "sourceCount" INTEGER NOT NULL DEFAULT 0,
  "fetchedCount" INTEGER NOT NULL DEFAULT 0,
  "acceptedCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedCount" INTEGER NOT NULL DEFAULT 0,
  "recommendedPriceCents" INTEGER,
  "confidence" TEXT,
  "queries" JSONB NOT NULL,
  "sourcesChecked" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sourceErrors" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CompSearchRun_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CompSearchRun"
  ADD CONSTRAINT "CompSearchRun_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "CompSearchRun_inventoryItemId_createdAt_idx"
  ON "CompSearchRun"("inventoryItemId", "createdAt");
