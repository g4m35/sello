-- Marketplace credential/config scoping. Marketplace connections are shared by
-- an account, while userId remains the member who connected/configured them.
-- Backfill is behavior-preserving: each existing solo seller is mapped to their
-- personal account, so existing connection reads continue to resolve once app
-- queries switch to accountId.

-- 1) Ensure every existing connection/config owner has a personal account.
INSERT INTO "Account" ("id", "ownerUserId", "plan", "createdAt", "updatedAt")
SELECT gen_random_uuid(), owners."userId", 'free', now(), now()
FROM (
  SELECT DISTINCT "userId" FROM "MarketplaceConnection"
  UNION
  SELECT DISTINCT "userId" FROM "EbaySellerConfig"
  UNION
  SELECT DISTINCT "userId" FROM "TikTokShopConfig"
) owners
WHERE owners."userId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "Account" a WHERE a."ownerUserId" = owners."userId"
  );

-- 2) Seed owner membership for any newly-created or previously incomplete account.
INSERT INTO "AccountMember" ("id", "accountId", "userId", "role", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), a."id", a."ownerUserId", 'owner', 'active', now(), now()
FROM "Account" a
WHERE NOT EXISTS (
  SELECT 1 FROM "AccountMember" m
  WHERE m."accountId" = a."id" AND m."role" = 'owner'
);

-- 3) Add account columns nullable for backfill.
ALTER TABLE "MarketplaceConnection" ADD COLUMN "accountId" UUID;
ALTER TABLE "EbaySellerConfig" ADD COLUMN "accountId" UUID;
ALTER TABLE "TikTokShopConfig" ADD COLUMN "accountId" UUID;

-- 4) Backfill from the user's personal account.
UPDATE "MarketplaceConnection" c
SET "accountId" = a."id"
FROM "Account" a
WHERE a."ownerUserId" = c."userId" AND c."accountId" IS NULL;

UPDATE "EbaySellerConfig" cfg
SET "accountId" = a."id"
FROM "Account" a
WHERE a."ownerUserId" = cfg."userId" AND cfg."accountId" IS NULL;

UPDATE "TikTokShopConfig" cfg
SET "accountId" = a."id"
FROM "Account" a
WHERE a."ownerUserId" = cfg."userId" AND cfg."accountId" IS NULL;

-- 5) Enforce account ownership from this point forward.
ALTER TABLE "MarketplaceConnection" ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "EbaySellerConfig" ALTER COLUMN "accountId" SET NOT NULL;
ALTER TABLE "TikTokShopConfig" ALTER COLUMN "accountId" SET NOT NULL;

CREATE UNIQUE INDEX "MarketplaceConnection_accountId_marketplace_environment_key"
  ON "MarketplaceConnection"("accountId", "marketplace", "environment");
CREATE INDEX "MarketplaceConnection_accountId_idx" ON "MarketplaceConnection"("accountId");

CREATE UNIQUE INDEX "EbaySellerConfig_accountId_marketplaceConnectionId_key"
  ON "EbaySellerConfig"("accountId", "marketplaceConnectionId");
CREATE INDEX "EbaySellerConfig_accountId_idx" ON "EbaySellerConfig"("accountId");

CREATE UNIQUE INDEX "TikTokShopConfig_accountId_marketplaceConnectionId_key"
  ON "TikTokShopConfig"("accountId", "marketplaceConnectionId");
CREATE INDEX "TikTokShopConfig_accountId_idx" ON "TikTokShopConfig"("accountId");

ALTER TABLE "MarketplaceConnection" ADD CONSTRAINT "MarketplaceConnection_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EbaySellerConfig" ADD CONSTRAINT "EbaySellerConfig_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TikTokShopConfig" ADD CONSTRAINT "TikTokShopConfig_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
