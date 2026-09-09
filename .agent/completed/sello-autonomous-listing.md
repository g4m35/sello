# Sello autonomous listing implementation

Implementation completed 2026-09-08 by Codex in `/Users/jheller/dev/sello-worktrees/autonomous-listing`, branch `feature/sello-autonomous-listing`. Implementation commit `612efe1`; base `a838e4001a1dcb5066713028aa22d8c1c2575280`. Independent reviewer: `autonomy_review`. Integration and production release remain pending.

## Outcome

The branch includes the previously reviewed removal of seven unreachable legacy UI files (2,678 lines). The maintained upload screen now has one photo-entry path and explicit optional eBay price-range consent. Pricing, optional item details, manual posting fields and activity use progressive disclosure; inventory defaults to ten items per bulk action and is the signed-in home.

Saved listings enter a persistent prepare/publish job. The worker uses conservative identity and USD sold-comp evidence, transactional version checks and shared guarded publishing. It does not replay unknown external outcomes. Scheduled eBay order checks use complete bounded windows, account-scoped reconciliation, visible failure notifications and the existing guarded delisting worker. Other marketplace capabilities remain honest manual/review paths.

## Validation

`npm run validate:full` passed on the final code using the committed CI workflow's placeholder environment, without reading or using production `.env` values: 242 test files, 1,765 tests, TypeScript, Prisma syntax validation and optimized Next.js production build. ESLint returned zero errors and two unused-variable warnings in `draft-actions.test.ts`; the same two warnings were observed in the clean-base validation recorded for the included legacy-removal change. `git diff --check` passed. `agent:check` passed after the coherent implementation commit and task-state registration.

New coverage includes account-scoped progress, scheduler authentication/order, job claims and membership changes, expired consent, wrong quantity, changed drafts, disabled/unknown publication, provider-error sanitization, USD evidence, size/style mismatches, final eBay payload aspects/price/quantity, mutable order result subdivision, cursor retention, missing scopes, monitor failure alerts and terminal upload retry boundaries. Existing route/gateway and inventory-reconciliation tests continue to pass.

## Browser evidence

Rendered actual modified React components and CSS using fake seller/provider boundaries in an external local fixture, opened only in the owner's existing Chrome session. No deployed authentication was bypassed. Desktop and 390-CSS-pixel phone checks showed no horizontal overflow (390 viewport, 380 document scroll width). Tested consent expansion, collapsed optional/pricing sections, pricing disclosure expansion and background completion. A typed title survived worker completion while its simulated save was still in flight.

Evidence: `/Users/jheller/dev/sello-recovery/autonomous-qa/` contains the fixture, `upload-desktop.png`, `upload-mobile.png`, `editor-desktop.png`, and `editor-mobile.png`. Initial live-product audit evidence remains in `/Users/jheller/dev/sello-recovery/product-review-2026-09-08/`. Browser viewport overrides and the test tab were cleaned up.

## Limits and release

No production migration, deployment, live provider request, marketplace publish/delist or merge was performed. The scheduler, secrets, eBay scopes/allowlists and permitted provider settings require production verification after explicit release authorization. This is bounded eBay automation with review exceptions, not full autonomous coverage of every marketplace. The first order scan covers seven days; older inventory requires reconciliation review. The initial photo-identification request still requires the upload page to remain open. See `docs/operations/autonomous-listing.md` for setup, runtime limits, failure handling and release checks.
