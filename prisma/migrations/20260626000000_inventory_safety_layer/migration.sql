-- Inventory safety layer / double-sell prevention (additive).
-- Adds source-of-truth quantity/sold-source tracking to InventoryItem, listing
-- URL/snapshot/metadata to MarketplaceListing, new audit/task/job/signal tables,
-- and new MarketplaceListingStatus variants. No application rows are changed.
-- New tables follow the project RLS pattern: RLS enabled, no policies; access is
-- the trusted resale_app role (BYPASSRLS), ownership enforced via userId filters.

-- New MarketplaceListingStatus variants (not used within this migration).
ALTER TYPE "MarketplaceListingStatus" ADD VALUE IF NOT EXISTS 'ENDED';
ALTER TYPE "MarketplaceListingStatus" ADD VALUE IF NOT EXISTS 'UNKNOWN';
ALTER TYPE "MarketplaceListingStatus" ADD VALUE IF NOT EXISTS 'NEEDS_REVIEW';
ALTER TYPE "MarketplaceListingStatus" ADD VALUE IF NOT EXISTS 'SUBMITTED_FOR_AUDIT';
ALTER TYPE "MarketplaceListingStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- New enums.
CREATE TYPE "InventoryEventType" AS ENUM ('listing_created', 'listing_active', 'sale_detected', 'sale_confirmed', 'sale_rejected', 'delist_requested', 'delist_succeeded', 'delist_failed', 'manual_action_required', 'notification_sent', 'sync_conflict');
CREATE TYPE "SignalSource" AS ENUM ('api', 'email', 'manual', 'system');
CREATE TYPE "ReviewTaskType" AS ENUM ('confirm_possible_sale', 'manual_delist_required', 'unmatched_marketplace_email', 'sync_conflict');
CREATE TYPE "ReviewTaskStatus" AS ENUM ('open', 'resolved', 'dismissed');
CREATE TYPE "SyncJobType" AS ENUM ('detect_status', 'mark_sold', 'delist_marketplace_listing', 'notify_user', 'create_review_task', 'update_inventory_quantity', 'update_price', 'sync_order');
CREATE TYPE "SyncJobStatus" AS ENUM ('queued', 'running', 'succeeded', 'failed', 'skipped', 'needs_review');
CREATE TYPE "EmailSignalType" AS ENUM ('sale_detected', 'offer_received', 'listing_published', 'listing_removed', 'payment_received', 'shipping_needed', 'unknown');

-- InventoryItem: source-of-truth safety columns.
ALTER TABLE "InventoryItem" ADD COLUMN "quantityAvailable" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "InventoryItem" ADD COLUMN "soldSourceMarketplace" "Marketplace";
ALTER TABLE "InventoryItem" ADD COLUMN "soldSourceListingId" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN "lockVersion" INTEGER NOT NULL DEFAULT 0;

-- MarketplaceListing: registry/url/snapshot columns.
ALTER TABLE "MarketplaceListing" ADD COLUMN "externalUrl" TEXT;
ALTER TABLE "MarketplaceListing" ADD COLUMN "titleSnapshot" TEXT;
ALTER TABLE "MarketplaceListing" ADD COLUMN "skuSnapshot" TEXT;
ALTER TABLE "MarketplaceListing" ADD COLUMN "metadata" JSONB;
ALTER TABLE "MarketplaceListing" ADD COLUMN "endedAt" TIMESTAMP(3);

-- InventoryEvent.
CREATE TABLE "InventoryEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "inventoryItemId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "InventoryEventType" NOT NULL,
    "source" "SignalSource" NOT NULL,
    "marketplace" "Marketplace",
    "confidence" DOUBLE PRECISION,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InventoryEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "InventoryEvent_inventoryItemId_createdAt_idx" ON "InventoryEvent"("inventoryItemId", "createdAt");
CREATE INDEX "InventoryEvent_userId_createdAt_idx" ON "InventoryEvent"("userId", "createdAt");
ALTER TABLE "InventoryEvent" ADD CONSTRAINT "InventoryEvent_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ReviewTask.
CREATE TABLE "ReviewTask" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "inventoryItemId" UUID,
    "marketplace" "Marketplace",
    "type" "ReviewTaskType" NOT NULL,
    "status" "ReviewTaskStatus" NOT NULL DEFAULT 'open',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "ReviewTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReviewTask_userId_status_idx" ON "ReviewTask"("userId", "status");
CREATE INDEX "ReviewTask_inventoryItemId_idx" ON "ReviewTask"("inventoryItemId");
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- SyncJob (idempotencyKey is a full UNIQUE).
CREATE TABLE "SyncJob" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "inventoryItemId" UUID,
    "marketplaceListingId" UUID,
    "type" "SyncJobType" NOT NULL,
    "status" "SyncJobStatus" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "idempotencyKey" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "payload" JSONB NOT NULL,
    "runAfter" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SyncJob_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SyncJob_idempotencyKey_key" ON "SyncJob"("idempotencyKey");
CREATE INDEX "SyncJob_status_runAfter_idx" ON "SyncJob"("status", "runAfter");
CREATE INDEX "SyncJob_userId_createdAt_idx" ON "SyncJob"("userId", "createdAt");
CREATE INDEX "SyncJob_inventoryItemId_idx" ON "SyncJob"("inventoryItemId");
CREATE INDEX "SyncJob_marketplaceListingId_idx" ON "SyncJob"("marketplaceListingId");

-- EmailSignal.
CREATE TABLE "EmailSignal" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID,
    "sourceEmail" TEXT NOT NULL,
    "destinationEmail" TEXT NOT NULL,
    "marketplaceGuess" "Marketplace",
    "signalType" "EmailSignalType" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "subject" TEXT NOT NULL,
    "bodySnippet" TEXT NOT NULL,
    "parsedPayload" JSONB NOT NULL,
    "matchedInventoryItemId" UUID,
    "matchedMarketplaceListingId" UUID,
    "providerMessageId" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailSignal_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "EmailSignal_providerMessageId_key" ON "EmailSignal"("providerMessageId");
CREATE INDEX "EmailSignal_userId_createdAt_idx" ON "EmailSignal"("userId", "createdAt");
CREATE INDEX "EmailSignal_signalType_createdAt_idx" ON "EmailSignal"("signalType", "createdAt");

-- Notification.
CREATE TABLE "Notification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "inventoryItemId" UUID,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- Defense-in-depth: app access is via the resale_app role (bypasses RLS); the
-- browser never queries these tables directly. Enabling RLS with no policy denies
-- the authenticated/anon roles by default (matches every other application table).
ALTER TABLE "InventoryEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReviewTask" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SyncJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailSignal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
