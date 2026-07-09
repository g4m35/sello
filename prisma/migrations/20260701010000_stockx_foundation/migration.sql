-- Add StockX catalog-match metadata to listing drafts. The token connection
-- itself uses the existing account-scoped MarketplaceConnection table.
ALTER TABLE "ListingDraft"
  ADD COLUMN "stockxProductId" TEXT,
  ADD COLUMN "stockxVariantId" TEXT,
  ADD COLUMN "stockxMatchSource" TEXT,
  ADD COLUMN "stockxMatchConfidence" DOUBLE PRECISION,
  ADD COLUMN "stockxMarketDataCheckedAt" TIMESTAMP(3);

CREATE INDEX "ListingDraft_stockxProductId_idx" ON "ListingDraft"("stockxProductId");
CREATE INDEX "ListingDraft_stockxVariantId_idx" ON "ListingDraft"("stockxVariantId");
