-- Build the account-scoped replacement before removing the stricter global
-- index so every committed intermediate state still rejects duplicate keys
-- within an account. Keep this as the migration's only SQL statement because
-- CREATE INDEX CONCURRENTLY cannot run in a transaction block.
CREATE UNIQUE INDEX CONCURRENTLY "Notification_accountId_dedupeKey_key"
  ON "Notification"("accountId", "dedupeKey");
