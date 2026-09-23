# Preparation recovery implementation

Owner-authorized scope: guarded explicit preparation recovery, truthful comparison-provider availability, and visible listing-automation failures. No schema, deployment, provider call, or live marketplace action.

Implemented an account-scoped preparation-only retry with an atomic old-job claim and new-job creation. Warning/confidence requirements remain unchanged. Stored publishing consent is never renewed. Publication checkpoints block recovery after an ambiguous external operation. Failure and stale-job parking write account-scoped, job-deduplicated review tasks in the same transaction. Retry resolves only the exact originating review task.

Removed five TODO-only comparison adapters from the runtime provider registry; existing provider controls remain unchanged.

Validation on 2026-09-23: all 245 test files / 1,802 tests passed; TypeScript no-emit passed; scoped ESLint passed; git diff whitespace check passed. No live services used. Independent review and integrated full build remain with the parent task.

Remaining limitations: retries do not bypass AI uncertainty, regenerate Gemini identification, or publish automatically; old publishing failures without checkpoints require marketplace reconciliation. Existing historical failed jobs are not backfilled into review tasks. Bulk durable generation is owned by a separate parallel implementation. Automatic pricing still needs an implemented/configured sold-comparison provider.

Follow-up: deleted the unused StockX market-data timestamp write. Comparison fetches no longer alter draft updatedAt and invalidate their own automatic-pricing optimistic guard. The nullable historical view field remains unchanged; no runtime readiness or UI consumer depends on it. The targeted StockX, automation and view suite passed all 30 tests, with TypeScript and scoped ESLint also passing.
