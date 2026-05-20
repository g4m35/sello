-- CreateEnum
CREATE TYPE "PublishAttemptStatus" AS ENUM ('NOT_IMPLEMENTED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "PublishAttempt" (
    "id" UUID NOT NULL,
    "marketplaceListingId" UUID NOT NULL,
    "status" "PublishAttemptStatus" NOT NULL DEFAULT 'NOT_IMPLEMENTED',
    "code" TEXT NOT NULL,
    "reason" TEXT,
    "adapterResult" JSONB,
    "requestedBy" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublishAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublishAttempt_marketplaceListingId_createdAt_idx" ON "PublishAttempt"("marketplaceListingId", "createdAt");

-- CreateIndex
CREATE INDEX "PublishAttempt_requestedBy_createdAt_idx" ON "PublishAttempt"("requestedBy", "createdAt");

-- AddForeignKey
ALTER TABLE "PublishAttempt" ADD CONSTRAINT "PublishAttempt_marketplaceListingId_fkey" FOREIGN KEY ("marketplaceListingId") REFERENCES "MarketplaceListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "MarketplaceEvent" (
    "id" UUID NOT NULL,
    "marketplaceListingId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketplaceEvent_marketplaceListingId_createdAt_idx" ON "MarketplaceEvent"("marketplaceListingId", "createdAt");

-- AddForeignKey
ALTER TABLE "MarketplaceEvent" ADD CONSTRAINT "MarketplaceEvent_marketplaceListingId_fkey" FOREIGN KEY ("marketplaceListingId") REFERENCES "MarketplaceListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS on the new tables. Like the other application tables, these are
-- only reached through trusted server-side Prisma connections, not the browser.
ALTER TABLE "PublishAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketplaceEvent" ENABLE ROW LEVEL SECURITY;
