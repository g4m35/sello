-- The account-scoped replacement is already valid before this runs. Keep this
-- as the migration's only SQL statement because DROP INDEX CONCURRENTLY cannot
-- run in a transaction block.
DROP INDEX CONCURRENTLY "Notification_dedupeKey_key";
