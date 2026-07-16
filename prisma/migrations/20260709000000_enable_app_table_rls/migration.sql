-- App-table RLS hardening (defense-in-depth).
-- Pre-condition: resale_app must BYPASSRLS or own these tables (already true for
-- MarketplaceConnection / EbaySellerConfig). Never force RLS on table owners.
-- Policies use (select auth.uid()) so the function is evaluated once per query.

-- Direct sellerId ownership
ALTER TABLE "InventoryItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "InventoryItem_user_all" ON "InventoryItem"
  FOR ALL TO authenticated
  USING ("sellerId" = (select auth.uid()))
  WITH CHECK ("sellerId" = (select auth.uid()));

-- One-hop via InventoryItem
ALTER TABLE "ItemPhoto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ItemPhoto_user_all" ON "ItemPhoto"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "InventoryItem" i
    WHERE i.id = "ItemPhoto"."inventoryItemId" AND i."sellerId" = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "InventoryItem" i
    WHERE i.id = "ItemPhoto"."inventoryItemId" AND i."sellerId" = (select auth.uid())
  ));

ALTER TABLE "MarketplaceImage" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "MarketplaceImage_user_all" ON "MarketplaceImage"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "InventoryItem" i
    WHERE i.id = "MarketplaceImage"."inventoryItemId" AND i."sellerId" = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "InventoryItem" i
    WHERE i.id = "MarketplaceImage"."inventoryItemId" AND i."sellerId" = (select auth.uid())
  ));

ALTER TABLE "AiOutput" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "AiOutput_user_all" ON "AiOutput"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "InventoryItem" i
    WHERE i.id = "AiOutput"."inventoryItemId" AND i."sellerId" = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "InventoryItem" i
    WHERE i.id = "AiOutput"."inventoryItemId" AND i."sellerId" = (select auth.uid())
  ));

ALTER TABLE "ListingDraft" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ListingDraft_user_all" ON "ListingDraft"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "InventoryItem" i
    WHERE i.id = "ListingDraft"."inventoryItemId" AND i."sellerId" = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "InventoryItem" i
    WHERE i.id = "ListingDraft"."inventoryItemId" AND i."sellerId" = (select auth.uid())
  ));

ALTER TABLE "PriceComp" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "PriceComp_user_all" ON "PriceComp"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "InventoryItem" i
    WHERE i.id = "PriceComp"."inventoryItemId" AND i."sellerId" = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "InventoryItem" i
    WHERE i.id = "PriceComp"."inventoryItemId" AND i."sellerId" = (select auth.uid())
  ));

ALTER TABLE "CompSearchRun" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "CompSearchRun_user_all" ON "CompSearchRun"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "InventoryItem" i
    WHERE i.id = "CompSearchRun"."inventoryItemId" AND i."sellerId" = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "InventoryItem" i
    WHERE i.id = "CompSearchRun"."inventoryItemId" AND i."sellerId" = (select auth.uid())
  ));

ALTER TABLE "MarketplaceListing" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "MarketplaceListing_user_all" ON "MarketplaceListing"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "InventoryItem" i
    WHERE i.id = "MarketplaceListing"."inventoryItemId" AND i."sellerId" = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "InventoryItem" i
    WHERE i.id = "MarketplaceListing"."inventoryItemId" AND i."sellerId" = (select auth.uid())
  ));

-- Two-hop via MarketplaceListing → InventoryItem
ALTER TABLE "PublishAttempt" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "PublishAttempt_user_all" ON "PublishAttempt"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "MarketplaceListing" ml
    JOIN "InventoryItem" i ON i.id = ml."inventoryItemId"
    WHERE ml.id = "PublishAttempt"."marketplaceListingId"
      AND i."sellerId" = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "MarketplaceListing" ml
    JOIN "InventoryItem" i ON i.id = ml."inventoryItemId"
    WHERE ml.id = "PublishAttempt"."marketplaceListingId"
      AND i."sellerId" = (select auth.uid())
  ));

ALTER TABLE "MarketplaceEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "MarketplaceEvent_user_all" ON "MarketplaceEvent"
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM "MarketplaceListing" ml
    JOIN "InventoryItem" i ON i.id = ml."inventoryItemId"
    WHERE ml.id = "MarketplaceEvent"."marketplaceListingId"
      AND i."sellerId" = (select auth.uid())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM "MarketplaceListing" ml
    JOIN "InventoryItem" i ON i.id = ml."inventoryItemId"
    WHERE ml.id = "MarketplaceEvent"."marketplaceListingId"
      AND i."sellerId" = (select auth.uid())
  ));

-- JobLog: seller-owned rows only; NULL inventoryItemId compliance rows stay
-- invisible to authenticated clients (server/resale_app only).
ALTER TABLE "JobLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "JobLog_user_all" ON "JobLog"
  FOR ALL TO authenticated
  USING (
    "inventoryItemId" IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "InventoryItem" i
      WHERE i.id = "JobLog"."inventoryItemId" AND i."sellerId" = (select auth.uid())
    )
  )
  WITH CHECK (
    "inventoryItemId" IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "InventoryItem" i
      WHERE i.id = "JobLog"."inventoryItemId" AND i."sellerId" = (select auth.uid())
    )
  );

-- Direct userId ownership
ALTER TABLE "ProviderCallLedger" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ProviderCallLedger_user_all" ON "ProviderCallLedger"
  FOR ALL TO authenticated
  USING ("userId" = (select auth.uid()))
  WITH CHECK ("userId" = (select auth.uid()));

ALTER TABLE "Feedback" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Feedback_user_all" ON "Feedback"
  FOR ALL TO authenticated
  USING ("userId" = (select auth.uid()))
  WITH CHECK ("userId" = (select auth.uid()));

ALTER TABLE "TikTokShopConfig" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "TikTokShopConfig_user_all" ON "TikTokShopConfig"
  FOR ALL TO authenticated
  USING ("userId" = (select auth.uid()))
  WITH CHECK ("userId" = (select auth.uid()));

ALTER TABLE "MarketplaceOrder" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "MarketplaceOrder_user_all" ON "MarketplaceOrder"
  FOR ALL TO authenticated
  USING ("userId" = (select auth.uid()))
  WITH CHECK ("userId" = (select auth.uid()));

-- System tables: enable RLS with no authenticated policy so anon/authenticated
-- get zero rows. resale_app (BYPASSRLS) continues to read/write.
ALTER TABLE "MarketplaceWebhookEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TikTokCategoryCache" ENABLE ROW LEVEL SECURITY;
