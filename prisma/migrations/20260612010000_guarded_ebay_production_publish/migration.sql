ALTER TABLE "MarketplaceListing"
  ADD COLUMN "environment" TEXT NOT NULL DEFAULT 'sandbox';

DROP INDEX "MarketplaceListing_inventoryItemId_marketplace_key";

CREATE UNIQUE INDEX "MarketplaceListing_inventoryItemId_marketplace_environment_key"
  ON "MarketplaceListing"("inventoryItemId", "marketplace", "environment");

CREATE INDEX "MarketplaceListing_marketplace_environment_status_idx"
  ON "MarketplaceListing"("marketplace", "environment", "status");

ALTER TABLE "PublishAttempt"
  ADD COLUMN "idempotencyKey" TEXT;

CREATE INDEX "PublishAttempt_idempotencyKey_idx"
  ON "PublishAttempt"("idempotencyKey");
