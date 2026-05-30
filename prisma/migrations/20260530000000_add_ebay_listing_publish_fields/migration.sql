-- AlterTable: persist eBay sandbox publish identifiers on the canonical listing row.
ALTER TABLE "MarketplaceListing" ADD COLUMN "sku" TEXT;
ALTER TABLE "MarketplaceListing" ADD COLUMN "externalOfferId" TEXT;
