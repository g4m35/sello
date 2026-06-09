-- Structured measurements and flaws on listing drafts (AI-prefilled,
-- seller-editable). Additive and nullable: existing rows are untouched and
-- older drafts simply have no structured data yet.

ALTER TABLE "ListingDraft" ADD COLUMN "measurements" JSONB;
ALTER TABLE "ListingDraft" ADD COLUMN "flaws" JSONB;
