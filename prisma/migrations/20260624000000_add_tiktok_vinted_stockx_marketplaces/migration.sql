-- Add TikTok Shop, Vinted and StockX as marketplace channels plus the supporting
-- models for the TikTok Shop integration scaffold (seller shop config, external
-- order mirror, webhook de-duplication, and a category-rule cache).
--
-- Additive only: no existing rows change. The new enum values carry NO publishing
-- capability on their own. Live publish/sync stays gated in the adapter/registry
-- layer (gated_scaffold for Vinted, catalog_match_scaffold for StockX, and a
-- dedicated handler for TikTok Shop), so adding the enum values cannot enable any
-- live marketplace operation by itself.
--
-- ALTER TYPE ... ADD VALUE is safe inside the migration transaction on
-- PostgreSQL 12+ because the new values are not referenced in this same
-- migration. IF NOT EXISTS makes re-running idempotent.
ALTER TYPE "Marketplace" ADD VALUE IF NOT EXISTS 'tiktok_shop';
ALTER TYPE "Marketplace" ADD VALUE IF NOT EXISTS 'vinted';
ALTER TYPE "Marketplace" ADD VALUE IF NOT EXISTS 'stockx';

-- Per-seller TikTok Shop connection state living beside MarketplaceConnection
-- (which holds the encrypted tokens). shop_cipher and the authorized shop id are
-- required to sign TikTok Shop API requests; they are seller-scoped, not secrets,
-- and are never logged.
CREATE TABLE "TikTokShopConfig" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "marketplaceConnectionId" UUID NOT NULL,
  "shopId" TEXT,
  "shopName" TEXT,
  "shopCipher" TEXT,
  "region" TEXT,
  "sellerName" TEXT,
  "readinessStatus" TEXT,
  "readinessCheckedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TikTokShopConfig_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "TikTokShopConfig"
  ADD CONSTRAINT "TikTokShopConfig_marketplaceConnectionId_fkey"
  FOREIGN KEY ("marketplaceConnectionId") REFERENCES "MarketplaceConnection"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "TikTokShopConfig_userId_marketplaceConnectionId_key"
  ON "TikTokShopConfig"("userId", "marketplaceConnectionId");
CREATE INDEX "TikTokShopConfig_userId_idx"
  ON "TikTokShopConfig"("userId");
CREATE INDEX "TikTokShopConfig_marketplaceConnectionId_idx"
  ON "TikTokShopConfig"("marketplaceConnectionId");

-- External marketplace orders (TikTok Shop first). Deduplicated by
-- (marketplace, environment, externalOrderId) so polling/webhooks are
-- idempotent. Canonical inventory is only marked sold from reliable
-- paid/confirmed statuses by the order-sync logic, never blindly from this row.
CREATE TABLE "MarketplaceOrder" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "marketplace" "Marketplace" NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'production',
  "externalOrderId" TEXT NOT NULL,
  "externalShopId" TEXT,
  "status" TEXT NOT NULL,
  "rawStatus" TEXT,
  "inventoryItemId" UUID,
  "externalProductId" TEXT,
  "externalSkuId" TEXT,
  "matched" BOOLEAN NOT NULL DEFAULT false,
  "payload" JSONB,
  "lastEventAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "MarketplaceOrder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketplaceOrder_marketplace_environment_externalOrderId_key"
  ON "MarketplaceOrder"("marketplace", "environment", "externalOrderId");
CREATE INDEX "MarketplaceOrder_userId_marketplace_idx"
  ON "MarketplaceOrder"("userId", "marketplace");
CREATE INDEX "MarketplaceOrder_inventoryItemId_idx"
  ON "MarketplaceOrder"("inventoryItemId");

-- Webhook/event de-duplication. A verified inbound event is recorded once;
-- re-delivery of the same (marketplace, eventId) is a no-op. Only sanitized
-- metadata is stored.
CREATE TABLE "MarketplaceWebhookEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "marketplace" "Marketplace" NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'production',
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "externalShopId" TEXT,
  "processedAt" TIMESTAMP(3),
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarketplaceWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketplaceWebhookEvent_marketplace_eventId_key"
  ON "MarketplaceWebhookEvent"("marketplace", "eventId");
CREATE INDEX "MarketplaceWebhookEvent_marketplace_eventType_createdAt_idx"
  ON "MarketplaceWebhookEvent"("marketplace", "eventType", "createdAt");

-- Cached TikTok Shop category rules/attributes. Category metadata is large and
-- changes slowly; caching avoids re-fetching on every readiness check and lets
-- readiness validate required attributes offline. fetchedAt drives TTL.
CREATE TABLE "TikTokCategoryCache" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "region" TEXT NOT NULL,
  "version" TEXT NOT NULL DEFAULT 'v1',
  "categoryId" TEXT NOT NULL,
  "categoryName" TEXT,
  "isLeaf" BOOLEAN NOT NULL DEFAULT false,
  "rules" JSONB,
  "attributes" JSONB,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TikTokCategoryCache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TikTokCategoryCache_region_version_categoryId_key"
  ON "TikTokCategoryCache"("region", "version", "categoryId");
CREATE INDEX "TikTokCategoryCache_region_version_idx"
  ON "TikTokCategoryCache"("region", "version");

-- Defense-in-depth: app access is via the resale_app role (bypasses RLS); the
-- browser never queries these tables directly. Enabling RLS with no policy denies
-- the authenticated/anon roles by default, so a row can never leak cross-user
-- even if a client query were ever introduced. Mirrors the project's existing
-- pattern for seller-scoped tables (e.g. ProviderCallLedger).
ALTER TABLE "TikTokShopConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketplaceOrder" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketplaceWebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TikTokCategoryCache" ENABLE ROW LEVEL SECURITY;
