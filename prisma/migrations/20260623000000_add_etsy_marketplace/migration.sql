-- Add Etsy as a marketplace channel. Additive only: extends the Marketplace
-- enum with 'etsy' so it can appear in selectedMarketplaces, MarketplaceListing,
-- MarketplaceConnection, and MarketplaceImage like the other channels. Etsy is a
-- copy-ready draft channel (no live publish adapter); the enum value carries no
-- publishing capability on its own — that stays gated in the adapter layer.
--
-- ALTER TYPE ... ADD VALUE is safe inside the migration transaction on
-- PostgreSQL 12+ because the new value is not referenced in this same migration.
-- IF NOT EXISTS makes re-running idempotent.
ALTER TYPE "Marketplace" ADD VALUE IF NOT EXISTS 'etsy';
