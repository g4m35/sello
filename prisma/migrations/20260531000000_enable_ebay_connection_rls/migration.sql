-- Defense-in-depth for encrypted eBay sandbox token/config storage.
-- Server-side service-role code continues to bypass RLS. If these tables are
-- ever reachable from Supabase authenticated clients, users may only see or
-- modify their own rows.

ALTER TABLE "MarketplaceConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EbaySellerConfig" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "MarketplaceConnection_user_select"
    ON "MarketplaceConnection"
    FOR SELECT
    TO authenticated
    USING ("userId" = auth.uid());

CREATE POLICY "MarketplaceConnection_user_insert"
    ON "MarketplaceConnection"
    FOR INSERT
    TO authenticated
    WITH CHECK ("userId" = auth.uid());

CREATE POLICY "MarketplaceConnection_user_update"
    ON "MarketplaceConnection"
    FOR UPDATE
    TO authenticated
    USING ("userId" = auth.uid())
    WITH CHECK ("userId" = auth.uid());

CREATE POLICY "MarketplaceConnection_user_delete"
    ON "MarketplaceConnection"
    FOR DELETE
    TO authenticated
    USING ("userId" = auth.uid());

CREATE POLICY "EbaySellerConfig_user_select"
    ON "EbaySellerConfig"
    FOR SELECT
    TO authenticated
    USING ("userId" = auth.uid());

CREATE POLICY "EbaySellerConfig_user_insert"
    ON "EbaySellerConfig"
    FOR INSERT
    TO authenticated
    WITH CHECK ("userId" = auth.uid());

CREATE POLICY "EbaySellerConfig_user_update"
    ON "EbaySellerConfig"
    FOR UPDATE
    TO authenticated
    USING ("userId" = auth.uid())
    WITH CHECK ("userId" = auth.uid());

CREATE POLICY "EbaySellerConfig_user_delete"
    ON "EbaySellerConfig"
    FOR DELETE
    TO authenticated
    USING ("userId" = auth.uid());
