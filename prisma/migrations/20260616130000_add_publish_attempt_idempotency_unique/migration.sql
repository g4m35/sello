-- Concurrency guard for eBay publish / delist / orphan-cleanup side effects.
--
-- The publish and delist handlers perform an in-memory "is there already an
-- active attempt?" check and then INSERT a RUNNING PublishAttempt. Under
-- concurrent requests for the same item, two callers can both pass the in-memory
-- check and both INSERT, producing duplicate live eBay side effects (two offers
-- / listings for one item). A SELECT-then-INSERT transaction at READ COMMITTED
-- does NOT prevent this; only a database uniqueness constraint does.
--
-- This partial UNIQUE index makes the database the source of truth: at most one
-- active-or-successful attempt may exist per (marketplaceListingId,
-- idempotencyKey). FAILED and NOT_IMPLEMENTED rows are intentionally excluded so
-- that legitimate retries after a failure remain allowed, and so non-eBay
-- NOT_IMPLEMENTED attempts never collide. Each operation uses a distinct
-- idempotencyKey suffix ("...:delist", "...:orphan-cleanup"), so publish and
-- delist never collide with one another.
--
-- Orphan-cleanup ("...:orphan-cleanup") is deliberately EXCLUDED: unlike publish
-- and delist, it is meant to run repeatedly (orphans recur) and writes a
-- SUCCEEDED attempt with a stable key, so constraining it would make a second
-- cleanup fail. This index targets only the non-repeatable publish/delist
-- operations. Rows with a NULL idempotencyKey are likewise excluded (NULLs are
-- distinct anyway), covering legacy and non-eBay attempts.
--
-- Prisma's schema language cannot express a partial (WHERE-filtered) unique
-- index, so this is applied as raw SQL and is not represented in schema.prisma.
--
-- SAFETY: creating this index FAILS LOUDLY (and rolls back, changing no data) if
-- pre-existing rows already violate it. Before applying to any environment with
-- historical data, confirm there are no duplicates:
--   SELECT "marketplaceListingId", "idempotencyKey", count(*)
--     FROM "PublishAttempt"
--     WHERE "status" IN ('QUEUED','RUNNING','SUCCEEDED')
--       AND "idempotencyKey" IS NOT NULL
--       AND "idempotencyKey" NOT LIKE '%:orphan-cleanup'
--     GROUP BY 1, 2 HAVING count(*) > 1;

CREATE UNIQUE INDEX "PublishAttempt_active_idempotency_key"
    ON "PublishAttempt" ("marketplaceListingId", "idempotencyKey")
    WHERE "status" IN ('QUEUED', 'RUNNING', 'SUCCEEDED')
      AND "idempotencyKey" NOT LIKE '%:orphan-cleanup';
