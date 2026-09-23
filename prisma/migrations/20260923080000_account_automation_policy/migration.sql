-- Additive, default-off authorization. Existing account RLS remains unchanged.
ALTER TABLE "Account" ADD COLUMN "automationPolicy" JSONB;
