-- Paid-beta P0 hardening. Forward-only and additive except for ownership
-- columns that are derived from authoritative parent rows before becoming
-- required. This migration performs no marketplace/provider operation.

-- -------------------------------------------------------------------------
-- Bulk-intake ownership consistency.
-- -------------------------------------------------------------------------

ALTER TABLE "BulkItem" ADD COLUMN "accountId" UUID;
ALTER TABLE "BulkPhoto" ADD COLUMN "accountId" UUID;

UPDATE "BulkItem" item
SET "accountId" = batch."accountId"
FROM "BulkBatch" batch
WHERE batch."id" = item."batchId" AND item."accountId" IS NULL;

UPDATE "BulkPhoto" photo
SET "accountId" = batch."accountId"
FROM "BulkBatch" batch
WHERE batch."id" = photo."batchId" AND photo."accountId" IS NULL;

-- Keep the migration/app deployment gap compatible. The pre-migration app does
-- not send child accountId yet, so derive it from the authoritative batch. A
-- mismatched explicit value fails closed.
CREATE FUNCTION "populate_bulk_child_account_id"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owning_account UUID;
BEGIN
  SELECT batch."accountId" INTO owning_account
  FROM "BulkBatch" batch
  WHERE batch."id" = NEW."batchId";
  IF owning_account IS NULL THEN
    RAISE EXCEPTION 'Bulk child batch does not exist';
  END IF;
  IF NEW."accountId" IS NOT NULL AND NEW."accountId" <> owning_account THEN
    RAISE EXCEPTION 'Bulk child account must match its batch';
  END IF;
  NEW."accountId" := owning_account;
  RETURN NEW;
END $$;

CREATE TRIGGER "BulkItem_populate_account_trigger"
BEFORE INSERT OR UPDATE OF "batchId", "accountId" ON "BulkItem"
FOR EACH ROW EXECUTE FUNCTION "populate_bulk_child_account_id"();

CREATE TRIGGER "BulkPhoto_populate_account_trigger"
BEFORE INSERT OR UPDATE OF "batchId", "accountId" ON "BulkPhoto"
FOR EACH ROW EXECUTE FUNCTION "populate_bulk_child_account_id"();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "BulkItem" item
    JOIN "InventoryItem" inventory ON inventory."id" = item."inventoryItemId"
    WHERE item."inventoryItemId" IS NOT NULL
      AND (inventory."accountId" IS NULL OR inventory."accountId" <> item."accountId")
  ) THEN
    RAISE EXCEPTION 'BulkItem contains a cross-account or unscoped inventory link';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "BulkPhoto" photo
    JOIN "BulkItem" item ON item."id" = photo."bulkItemId"
    WHERE photo."bulkItemId" IS NOT NULL
      AND (item."batchId" <> photo."batchId" OR item."accountId" <> photo."accountId")
  ) THEN
    RAISE EXCEPTION 'BulkPhoto contains a cross-batch or cross-account item link';
  END IF;
END $$;

ALTER TABLE "BulkItem" ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "BulkPhoto" ALTER COLUMN "accountId" SET NOT NULL;

CREATE UNIQUE INDEX "InventoryItem_id_accountId_key" ON "InventoryItem"("id", "accountId");
CREATE UNIQUE INDEX "BulkBatch_id_accountId_key" ON "BulkBatch"("id", "accountId");
CREATE UNIQUE INDEX "BulkItem_id_batchId_key" ON "BulkItem"("id", "batchId");
CREATE INDEX "BulkItem_accountId_status_updatedAt_idx" ON "BulkItem"("accountId", "status", "updatedAt");
CREATE INDEX "BulkPhoto_accountId_createdAt_idx" ON "BulkPhoto"("accountId", "createdAt");

ALTER TABLE "BulkItem" ADD CONSTRAINT "BulkItem_batchId_accountId_fkey"
  FOREIGN KEY ("batchId", "accountId") REFERENCES "BulkBatch"("id", "accountId")
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "BulkItem" VALIDATE CONSTRAINT "BulkItem_batchId_accountId_fkey";

ALTER TABLE "BulkItem" ADD CONSTRAINT "BulkItem_inventoryItemId_accountId_fkey"
  FOREIGN KEY ("inventoryItemId", "accountId") REFERENCES "InventoryItem"("id", "accountId")
  ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
ALTER TABLE "BulkItem" VALIDATE CONSTRAINT "BulkItem_inventoryItemId_accountId_fkey";

ALTER TABLE "BulkPhoto" ADD CONSTRAINT "BulkPhoto_batchId_accountId_fkey"
  FOREIGN KEY ("batchId", "accountId") REFERENCES "BulkBatch"("id", "accountId")
  ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "BulkPhoto" VALIDATE CONSTRAINT "BulkPhoto_batchId_accountId_fkey";

-- A trigger is used instead of a second BulkPhoto->BulkItem foreign key because
-- regrouping intentionally deletes BulkItem rows while retaining photos and
-- setting only bulkItemId/itemPosition to NULL.
CREATE FUNCTION "enforce_bulk_photo_item_ownership"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."bulkItemId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "BulkItem" item
    WHERE item."id" = NEW."bulkItemId"
      AND item."batchId" = NEW."batchId"
      AND item."accountId" = NEW."accountId"
  ) THEN
    RAISE EXCEPTION 'BulkPhoto item must belong to the same batch and account';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "BulkPhoto_item_ownership_trigger"
BEFORE INSERT OR UPDATE OF "bulkItemId", "batchId", "accountId" ON "BulkPhoto"
FOR EACH ROW EXECUTE FUNCTION "enforce_bulk_photo_item_ownership"();

-- -------------------------------------------------------------------------
-- Atomic usage reservation and account-scoped provider accounting.
-- -------------------------------------------------------------------------

ALTER TABLE "Account" ADD COLUMN "disabledAt" TIMESTAMP(3);
ALTER TABLE "Account" ADD COLUMN "disableReason" TEXT;
ALTER TABLE "Subscription" ADD COLUMN "graceEndsAt" TIMESTAMP(3);

CREATE TYPE "UsageReservationStatus" AS ENUM (
  'reserved', 'settled', 'released', 'expired', 'denied'
);

CREATE TABLE "UsageReservation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" UUID NOT NULL,
  "metric" "UsageMetric" NOT NULL,
  "periodStart" DATE NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "units" INTEGER NOT NULL DEFAULT 1,
  "status" "UsageReservationStatus" NOT NULL DEFAULT 'reserved',
  "planSnapshot" "PlanTier" NOT NULL,
  "limitSnapshot" INTEGER NOT NULL,
  "denialReason" TEXT,
  "reservedByUserId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "settledAt" TIMESTAMP(3),
  "releasedAt" TIMESTAMP(3),
  CONSTRAINT "UsageReservation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "UsageReservation_units_check" CHECK ("units" > 0),
  CONSTRAINT "UsageReservation_limitSnapshot_check" CHECK ("limitSnapshot" >= 0)
);

CREATE UNIQUE INDEX "UsageReservation_accountId_metric_idempotencyKey_key"
  ON "UsageReservation"("accountId", "metric", "idempotencyKey");
CREATE INDEX "UsageReservation_accountId_metric_periodStart_status_idx"
  ON "UsageReservation"("accountId", "metric", "periodStart", "status");
CREATE INDEX "UsageReservation_status_createdAt_idx"
  ON "UsageReservation"("status", "createdAt");
ALTER TABLE "UsageReservation" ADD CONSTRAINT "UsageReservation_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UsageReservation" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "ProviderCallLedger" ADD COLUMN "accountId" UUID;
ALTER TABLE "ProviderCallLedger" ADD COLUMN "idempotencyKey" TEXT;
ALTER TABLE "ProviderCallLedger" ADD COLUMN "actualCostCents" INTEGER;
ALTER TABLE "ProviderCallLedger" ADD COLUMN "settledAt" TIMESTAMP(3);

UPDATE "ProviderCallLedger" ledger
SET "accountId" = inventory."accountId"
FROM "InventoryItem" inventory
WHERE inventory."id" = ledger."inventoryItemId"
  AND ledger."accountId" IS NULL;

UPDATE "ProviderCallLedger" ledger
SET "accountId" = account."id"
FROM "Account" account
WHERE account."ownerUserId" = ledger."userId"
  AND ledger."accountId" IS NULL;

CREATE INDEX "ProviderCallLedger_accountId_createdAt_idx"
  ON "ProviderCallLedger"("accountId", "createdAt");
CREATE UNIQUE INDEX "ProviderCallLedger_accountId_idempotencyKey_key"
  ON "ProviderCallLedger"("accountId", "idempotencyKey")
  WHERE "accountId" IS NOT NULL AND "idempotencyKey" IS NOT NULL;
ALTER TABLE "ProviderCallLedger" ADD CONSTRAINT "ProviderCallLedger_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;
ALTER TABLE "ProviderCallLedger" VALIDATE CONSTRAINT "ProviderCallLedger_accountId_fkey";

-- -------------------------------------------------------------------------
-- Account-scoped, lease-aware inventory jobs and audit records.
-- -------------------------------------------------------------------------

ALTER TYPE "SyncJobStatus" ADD VALUE IF NOT EXISTS 'retry_wait';
ALTER TYPE "SyncJobStatus" ADD VALUE IF NOT EXISTS 'canceled';

ALTER TABLE "SyncJob" ADD COLUMN "accountId" UUID;
ALTER TABLE "SyncJob" ADD COLUMN "lockedAt" TIMESTAMP(3);
ALTER TABLE "SyncJob" ADD COLUMN "leaseOwner" TEXT;
ALTER TABLE "SyncJob" ADD COLUMN "retryClass" TEXT;
ALTER TABLE "SyncJob" ADD COLUMN "completedAt" TIMESTAMP(3);

UPDATE "SyncJob" job
SET "accountId" = inventory."accountId"
FROM "InventoryItem" inventory
WHERE inventory."id" = job."inventoryItemId" AND job."accountId" IS NULL;

CREATE INDEX "SyncJob_accountId_status_runAfter_idx"
  ON "SyncJob"("accountId", "status", "runAfter");
ALTER TABLE "SyncJob" ADD CONSTRAINT "SyncJob_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;
ALTER TABLE "SyncJob" VALIDATE CONSTRAINT "SyncJob_accountId_fkey";

ALTER TABLE "InventoryEvent" ADD COLUMN "accountId" UUID;
ALTER TABLE "InventoryEvent" ADD COLUMN "externalEventId" TEXT;
ALTER TABLE "InventoryEvent" ADD COLUMN "correlationId" TEXT;
UPDATE "InventoryEvent" event
SET "accountId" = inventory."accountId"
FROM "InventoryItem" inventory
WHERE inventory."id" = event."inventoryItemId" AND event."accountId" IS NULL;
CREATE INDEX "InventoryEvent_accountId_createdAt_idx" ON "InventoryEvent"("accountId", "createdAt");
CREATE INDEX "InventoryEvent_marketplace_externalEventId_idx" ON "InventoryEvent"("marketplace", "externalEventId");
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;
ALTER TABLE "InventoryEvent" VALIDATE CONSTRAINT "InventoryEvent_accountId_fkey";

ALTER TABLE "ReviewTask" ADD COLUMN "accountId" UUID;
ALTER TABLE "ReviewTask" ADD COLUMN "dedupeKey" TEXT;
UPDATE "ReviewTask" task
SET "accountId" = inventory."accountId"
FROM "InventoryItem" inventory
WHERE inventory."id" = task."inventoryItemId" AND task."accountId" IS NULL;
CREATE INDEX "ReviewTask_accountId_status_createdAt_idx" ON "ReviewTask"("accountId", "status", "createdAt");
CREATE INDEX "ReviewTask_dedupeKey_idx" ON "ReviewTask"("dedupeKey");
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;
ALTER TABLE "ReviewTask" VALIDATE CONSTRAINT "ReviewTask_accountId_fkey";

ALTER TABLE "Notification" ADD COLUMN "accountId" UUID;
ALTER TABLE "Notification" ADD COLUMN "dedupeKey" TEXT;
UPDATE "Notification" notification
SET "accountId" = inventory."accountId"
FROM "InventoryItem" inventory
WHERE inventory."id" = notification."inventoryItemId" AND notification."accountId" IS NULL;
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");
CREATE INDEX "Notification_accountId_createdAt_idx" ON "Notification"("accountId", "createdAt");
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE
  NOT VALID;
ALTER TABLE "Notification" VALIDATE CONSTRAINT "Notification_accountId_fkey";

-- -------------------------------------------------------------------------
-- Durable, account-scoped marketplace sale-signal deduplication.
-- -------------------------------------------------------------------------

CREATE TABLE "MarketplaceSaleSignal" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "accountId" UUID NOT NULL,
  "inventoryItemId" UUID,
  "marketplace" "Marketplace" NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'production',
  "externalEventId" TEXT NOT NULL,
  "externalOrderId" TEXT,
  "externalLineItemId" TEXT,
  "externalListingId" TEXT,
  "state" TEXT NOT NULL,
  "outcome" TEXT,
  "sanitizedPayload" JSONB NOT NULL,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MarketplaceSaleSignal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MarketplaceSaleSignal_account_marketplace_environment_event_key"
  ON "MarketplaceSaleSignal"("accountId", "marketplace", "environment", "externalEventId");
CREATE INDEX "MarketplaceSaleSignal_accountId_marketplace_createdAt_idx"
  ON "MarketplaceSaleSignal"("accountId", "marketplace", "createdAt");
CREATE INDEX "MarketplaceSaleSignal_inventoryItemId_createdAt_idx"
  ON "MarketplaceSaleSignal"("inventoryItemId", "createdAt");
CREATE INDEX "MarketplaceSaleSignal_externalOrderId_externalLineItemId_idx"
  ON "MarketplaceSaleSignal"("externalOrderId", "externalLineItemId");
ALTER TABLE "MarketplaceSaleSignal" ADD CONSTRAINT "MarketplaceSaleSignal_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MarketplaceSaleSignal" ADD CONSTRAINT "MarketplaceSaleSignal_inventoryItemId_fkey"
  FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MarketplaceSaleSignal" ENABLE ROW LEVEL SECURITY;
