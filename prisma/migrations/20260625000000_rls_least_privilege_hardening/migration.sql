-- RLS least-privilege hardening.
--
-- Establishes a uniform deny-all posture across every public table: RLS is
-- enabled with NO policies, so the authenticated/anon Supabase roles are denied
-- by default. The application reaches these tables only through the trusted
-- server-side resale_app role (which has BYPASSRLS); the browser never queries
-- them directly (Supabase is used only for auth and Storage). Verified: there
-- are zero Supabase .from("<table>") queries in the codebase; all relational
-- access is Prisma, and ownership is enforced in application code via
-- sellerId/userId = auth.uid() WHERE filters.
--
-- This migration is additive: it changes no application rows and creates no
-- permissive policy.

-- 1) Close the only remaining gap. CompSearchRun (migration 20260614120000) was
--    created without RLS, unlike every other application table. Enabling RLS
--    with no policy denies authenticated/anon by default, matches its sibling
--    tables, and resolves the Supabase Advisor rls_disabled_in_public finding.
ALTER TABLE "CompSearchRun" ENABLE ROW LEVEL SECURITY;

-- 2) Remove the eBay-connection authenticated policies. They are the only
--    policies in the schema and are not justified by any code path: no
--    authenticated/anon client ever queries these tables (all access is the
--    resale_app role via Prisma, which bypasses RLS; the service-role client is
--    used only for Storage). Dropping them makes the posture uniform (deny-all
--    everywhere) and is strictly MORE restrictive than before -- an
--    authenticated user can no longer read even their own encrypted-token rows.
--    RLS remains ENABLED on both tables; resale_app access is unaffected.
DROP POLICY IF EXISTS "MarketplaceConnection_user_select" ON "MarketplaceConnection";
DROP POLICY IF EXISTS "MarketplaceConnection_user_insert" ON "MarketplaceConnection";
DROP POLICY IF EXISTS "MarketplaceConnection_user_update" ON "MarketplaceConnection";
DROP POLICY IF EXISTS "MarketplaceConnection_user_delete" ON "MarketplaceConnection";
DROP POLICY IF EXISTS "EbaySellerConfig_user_select" ON "EbaySellerConfig";
DROP POLICY IF EXISTS "EbaySellerConfig_user_insert" ON "EbaySellerConfig";
DROP POLICY IF EXISTS "EbaySellerConfig_user_update" ON "EbaySellerConfig";
DROP POLICY IF EXISTS "EbaySellerConfig_user_delete" ON "EbaySellerConfig";
