-- Resolve Supabase performance advisor findings for eBay connection storage.
-- Historical eBay migrations are already applied in Supabase, so this
-- corrective migration avoids changing their Prisma checksums.

ALTER POLICY "MarketplaceConnection_user_select"
    ON "MarketplaceConnection"
    USING ("userId" = (select auth.uid()));

ALTER POLICY "MarketplaceConnection_user_insert"
    ON "MarketplaceConnection"
    WITH CHECK ("userId" = (select auth.uid()));

ALTER POLICY "MarketplaceConnection_user_update"
    ON "MarketplaceConnection"
    USING ("userId" = (select auth.uid()))
    WITH CHECK ("userId" = (select auth.uid()));

ALTER POLICY "MarketplaceConnection_user_delete"
    ON "MarketplaceConnection"
    USING ("userId" = (select auth.uid()));

ALTER POLICY "EbaySellerConfig_user_select"
    ON "EbaySellerConfig"
    USING ("userId" = (select auth.uid()));

ALTER POLICY "EbaySellerConfig_user_insert"
    ON "EbaySellerConfig"
    WITH CHECK ("userId" = (select auth.uid()));

ALTER POLICY "EbaySellerConfig_user_update"
    ON "EbaySellerConfig"
    USING ("userId" = (select auth.uid()))
    WITH CHECK ("userId" = (select auth.uid()));

ALTER POLICY "EbaySellerConfig_user_delete"
    ON "EbaySellerConfig"
    USING ("userId" = (select auth.uid()));

CREATE INDEX "EbaySellerConfig_marketplaceConnectionId_idx"
    ON "EbaySellerConfig"("marketplaceConnectionId");
