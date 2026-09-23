# Durable bulk preparation implementation

Bulk generation now saves the currently edited photo groups and persistent per-item jobs in one transaction. Existing JobLog rows form the `bulk-generation-v1` queue. Generate responds immediately, runs one item after the response, and leaves the remainder for the existing authenticated scheduler. The browser polls progress instead of driving generation; the separate Save groups step is removed.

Each generation attempt has a stable queue key. The worker rechecks the initiating user's account access and effective plan. The existing generation service retains the bulk kill switch, quota reservations and Gemini boundary validation. Attempt fences prevent an older job or late provider response from overwriting a newer attempt. Successful inventory creation atomically enqueues `automationJobData` with prepare mode only; no automatic publishing authorization is created.

Interrupted provider work and uncertain writes become visible review exceptions and require usage reconciliation. Neither is automatically replayed. Canceling already-started generation reconciles its reservation instead of releasing it as unused. Legacy interrupted generating items are included in scheduler recovery.

Validation: 54 focused tests across bulk services, workers, API routes and existing UI tests passed; TypeScript and focused ESLint passed; git diff check passed. Fake providers only. No live provider calls, production migrations, pushes or deployments.

Integration required: invoke `runBulkGenerationQueue(db, deadline)` from `@/lib/bulk-intake/jobs` in the existing authenticated worker, after sale protection and with a bounded allocation that leaves listing preparation time. Root owns full integrated validation and independent review. No schema or dependencies changed.

Limitations: scheduler availability is required for work beyond the first item. Interruptions during paid generation intentionally need review rather than a silent duplicate provider attempt. Initial photo uploading still requires the browser until the stored-photo registration finishes. Generated listings are prepared automatically but bulk submission grants no marketplace publishing consent.
