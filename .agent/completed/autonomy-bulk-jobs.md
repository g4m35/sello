# Durable bulk preparation implementation

Bulk generation now saves the currently edited photo groups and persistent per-item jobs in one transaction. Existing JobLog rows form the `bulk-generation-v1` queue. Generate responds immediately, runs one item after the response, and leaves the remainder for the existing authenticated scheduler. The browser polls progress instead of driving generation; the separate Save groups step is removed.

Each generation attempt has a stable queue key. The worker rechecks the initiating user's account access and effective plan. The existing generation service retains the bulk kill switch, quota reservations and Gemini boundary validation. Attempt fences prevent an older job or late provider response from overwriting a newer attempt. Successful inventory creation atomically enqueues `automationJobData` with prepare mode only; no automatic publishing authorization is created.

Interrupted provider work and uncertain writes become visible review exceptions and require usage reconciliation. Neither is automatically replayed. Canceling already-started generation reconciles its reservation instead of releasing it as unused. Legacy interrupted generating items are included in scheduler recovery.

Validation: 54 focused tests across bulk services, workers, API routes and existing UI tests passed; TypeScript and focused ESLint passed; git diff check passed. Fake providers only. No live provider calls, production migrations, pushes or deployments.

Integration required: invoke `runBulkGenerationQueue(db, deadline)` from `@/lib/bulk-intake/jobs` in the existing authenticated worker, after sale protection and with a bounded allocation that leaves listing preparation time. Root owns full integrated validation and independent review. No schema or dependencies changed.

Limitations: scheduler availability is required for work beyond the first item. Interruptions during paid generation intentionally need review rather than a silent duplicate provider attempt. Initial photo uploading still requires the browser until the stored-photo registration finishes. Generated listings are prepared automatically but bulk submission grants no marketplace publishing consent.

## Independent review corrections

JobLog IDs now use namespaced deterministic UUID v8 values instead of non-UUID strings. Two tests ran against an isolated local PostgreSQL 15 cluster: both job kinds inserted into a UUID primary key, repeated attempts deduplicated, and the former IDs were rejected. No application database was accessed; the temporary cluster was stopped and removed. These PostgreSQL tests explicitly skip on hosts without local PostgreSQL binaries.

Photo registration, grouping/enqueue, claiming, provider-start authorization, cancellation, and summary refresh now share the same per-batch advisory lock. Claiming and the processing status update are atomic. A canceled item is checked before reservation and again after photo download under the lock before marking provider work started. Cancellation cannot revert the batch to processing; in-flight provider work may finish but cannot save over a canceled item.

The bulk worker leaves jobs queued when less than 90 seconds remain; route duration for one after-response job is 180 seconds. This is admission headroom, not a hard abort deadline for an already-running external call. Final interruption recovery remains necessary.

Follow-up validation: 60 focused tests passed, including the two real PostgreSQL checks and cancellation interleaving regressions. TypeScript, ESLint and diff checks passed.

## Bounded external waits

The scheduler deadline now reaches bulk generation. Each item has a 120-second total work cap and reserves 20 seconds for database settlement. Photo download waits are capped at 30 seconds and the remaining provider budget. Gemini waits are bounded at the pure generation boundary, with the installed SDK receiving AbortSignal and a finite HTTP timeout; existing callers also receive a finite default timeout. Neither the complete service nor its database writes are raced.

If a started Gemini call times out, the item is parked as BULK_GENERATION_UNCERTAIN and usage is marked for reconciliation, never released or automatically retried. Aborting the client request does not establish that the provider canceled billing. A late photo/provider promise cannot resume inventory writes. A download timeout before provider start releases the unused reservation and remains a visible failure.

Validation: 64 focused tests passed including real PostgreSQL UUID checks, simulated stalled downloads and Gemini with late resolution, reservation preservation, no late writes, and SDK abort/timeout forwarding. TypeScript, focused ESLint and diff checks passed. No live calls.
