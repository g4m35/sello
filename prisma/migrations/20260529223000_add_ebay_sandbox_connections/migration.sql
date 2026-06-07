-- eBay sandbox OAuth connection and readiness persistence.
-- This migration only creates storage for sandbox setup. It does not enable
-- production eBay publishing or call any marketplace API.

CREATE TABLE "MarketplaceConnection" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "marketplace" "Marketplace" NOT NULL,
    "environment" TEXT NOT NULL,
    "externalUserId" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketplaceConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EbaySellerConfig" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "marketplaceConnectionId" UUID NOT NULL,
    "marketplaceId" TEXT NOT NULL DEFAULT 'EBAY_US',
    "paymentPolicyId" TEXT,
    "fulfillmentPolicyId" TEXT,
    "returnPolicyId" TEXT,
    "merchantLocationKey" TEXT,
    "readinessStatus" TEXT,
    "readinessCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EbaySellerConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MarketplaceConnection_userId_marketplace_environment_key"
    ON "MarketplaceConnection"("userId", "marketplace", "environment");

CREATE INDEX "MarketplaceConnection_userId_idx"
    ON "MarketplaceConnection"("userId");

CREATE INDEX "MarketplaceConnection_marketplace_environment_idx"
    ON "MarketplaceConnection"("marketplace", "environment");

CREATE UNIQUE INDEX "EbaySellerConfig_userId_marketplaceConnectionId_key"
    ON "EbaySellerConfig"("userId", "marketplaceConnectionId");

CREATE INDEX "EbaySellerConfig_userId_idx"
    ON "EbaySellerConfig"("userId");

ALTER TABLE "EbaySellerConfig"
    ADD CONSTRAINT "EbaySellerConfig_marketplaceConnectionId_fkey"
    FOREIGN KEY ("marketplaceConnectionId") REFERENCES "MarketplaceConnection"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
