-- Inventory shared-workspace scoping. Additive + backfill, behavior-preserving:
-- each existing seller gets a personal Account (if absent) and every
-- InventoryItem is stamped with that account. A single-member account scopes
-- identically to the old sellerId filter, so app behavior is unchanged until
-- members are invited. RLS is untouched (InventoryItem already has deny-all RLS;
-- adding a column does not change it).

-- 1) Ensure every existing seller has a personal account.
INSERT INTO "Account" ("id", "ownerUserId", "plan", "createdAt", "updatedAt")
SELECT gen_random_uuid(), s."sellerId", 'free', now(), now()
FROM (SELECT DISTINCT "sellerId" FROM "InventoryItem") s
WHERE NOT EXISTS (
  SELECT 1 FROM "Account" a WHERE a."ownerUserId" = s."sellerId"
);

-- 2) Seed the owner membership for any account that lacks one.
INSERT INTO "AccountMember" ("id", "accountId", "userId", "role", "status", "createdAt", "updatedAt")
SELECT gen_random_uuid(), a."id", a."ownerUserId", 'owner', 'active', now(), now()
FROM "Account" a
WHERE NOT EXISTS (
  SELECT 1 FROM "AccountMember" m WHERE m."accountId" = a."id" AND m."role" = 'owner'
);

-- 3) Add the owning-account column (nullable for the backfill).
ALTER TABLE "InventoryItem" ADD COLUMN "accountId" UUID;

-- 4) Backfill accountId from the owner's account.
UPDATE "InventoryItem" i
SET "accountId" = a."id"
FROM "Account" a
WHERE a."ownerUserId" = i."sellerId" AND i."accountId" IS NULL;

-- 5) Index + foreign key (SET NULL on delete to match the optional relation).
CREATE INDEX "InventoryItem_accountId_status_idx" ON "InventoryItem"("accountId", "status");
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
