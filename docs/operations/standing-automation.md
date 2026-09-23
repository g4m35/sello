# Saved automation and marketplace release

The original Sello interface is retained. Settings now stores owner-authorized eBay posting bounds for future photo uploads and bulk listings. The default is paused. Saving requires a fresh revision and explicit authorization. Other account members can read the setting but cannot change it. Existing inventory never gains permission retroactively.

New uploads use the saved authorization automatically when enabled; a seller can uncheck it to prepare one item for review. An explicit per-item authorization remains supported and expires after 24 hours. Standing permission lasts until paused/changed; workers check its revision before pricing and immediately before the eBay publish action. Changed policies send queued work to review rather than renewing permission silently. A request already sent to a marketplace cannot be recalled.

Identification confidence, sold-comparison quality, price bounds, single-item quantity, seller setup, plan/usage, provider budgets and live-action switches remain required. Automation is not permission to invent missing product facts or publish unsupported listings. Recovery of an uncertain remote action requires reconciliation, not a second blind publish.

Etsy now has guarded draft creation/resumption, current API authentication and required processing profile, transactional sold reconciliation, recurring status checks and verified cross-marketplace removal. Production has no ETSY_* environment entries as of this release. Live Etsy use remains unavailable until application credentials, shop authorization, seller-specific required fields and scoped feature access are configured. No Etsy flag was enabled and no live marketplace listing was created during verification.

Production cron is enabled every minute. The worker prioritizes sale protection, then sale checks, then bulk/listing preparation. StockX and eligible Etsy listing checks are due every five minutes. Readiness and failure tasks remain visible to sellers.

## Rollout

Apply only `20260923080000_account_automation_policy` before deploying code. The migration adds one nullable JSONB Account field; existing rows remain disabled and account RLS remains unchanged. Run Prisma migration status first and do not apply unrelated pending migrations. Reverting application code can leave the nullable column in place. Never drop authorization history as a rollback.

This release incorporates dependency PR146. The 17 original dependency PRs are resolved by that consolidation; compatibility decisions and residual Prisma/deepmerge audit findings are documented in dependency-pr-consolidation-2026-09-23.md.

## Verification

Independent backend review approved owner/account boundaries, revision invalidation, adapter publish checks and additive migration. UI browser fixtures exercise enabled/paused policies, explicit save consent, stale revision errors, nonowner behavior and single-listing opt-out on desktop/mobile. Fixtures make no live provider calls; screenshots do not imply live marketplace success. Production schema/deployment checks are recorded separately after rollout.
