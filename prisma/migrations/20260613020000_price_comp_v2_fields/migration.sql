-- PriceComp v2: provider-ready columns. Additive only. FK + RLS unchanged.
-- Existing rows backfill via column defaults (status=unknown, sourceType=manual,
-- usedInPricing=true, ignoredAsOutlier=false, currency=USD), so old manual comps
-- keep working unchanged.

-- CreateEnum
CREATE TYPE "CompSourceType" AS ENUM ('manual', 'api', 'scraper', 'visual_search');

-- CreateEnum
CREATE TYPE "CompStatus" AS ENUM ('sold', 'active', 'unknown');

-- AlterTable
ALTER TABLE "PriceComp"
  ADD COLUMN "sourceType" "CompSourceType" NOT NULL DEFAULT 'manual',
  ADD COLUMN "platform" TEXT,
  ADD COLUMN "status" "CompStatus" NOT NULL DEFAULT 'unknown',
  ADD COLUMN "brand" TEXT,
  ADD COLUMN "size" TEXT,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN "totalPriceCents" INTEGER,
  ADD COLUMN "imageUrl" TEXT,
  ADD COLUMN "matchScore" DOUBLE PRECISION,
  ADD COLUMN "usedInPricing" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "ignoredAsOutlier" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rawJson" JSONB;
