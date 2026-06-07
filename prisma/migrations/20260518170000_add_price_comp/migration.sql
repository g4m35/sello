-- CreateTable
CREATE TABLE "PriceComp" (
    "id" UUID NOT NULL,
    "inventoryItemId" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "shippingCents" INTEGER NOT NULL DEFAULT 0,
    "soldDate" TIMESTAMP(3),
    "url" TEXT,
    "condition" "ItemCondition" NOT NULL DEFAULT 'unknown',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceComp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceComp_inventoryItemId_createdAt_idx" ON "PriceComp"("inventoryItemId", "createdAt");

-- AddForeignKey
ALTER TABLE "PriceComp" ADD CONSTRAINT "PriceComp_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS on the comps table. Like the other application tables, this is
-- only reached through trusted server-side Prisma connections, not the browser.
ALTER TABLE "PriceComp" ENABLE ROW LEVEL SECURITY;
