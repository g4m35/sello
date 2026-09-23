Adds nullable JSONB policy to the existing account row. No backfill: NULL is disabled.
Deploy the migration before application code that selects Account. Existing account
RLS is unchanged. Rollback by pausing automation and reverting application code;
leave this nullable column in place rather than destroying recorded authorization.
A policy change invalidates existing standing-job revision references. It never
adds authorization to existing inventory. Already-started marketplace requests
cannot be recalled and must be reconciled through normal publish activity.
