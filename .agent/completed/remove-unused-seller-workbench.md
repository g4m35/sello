# Remove the unused seller workbench

Date: 2026-09-08
Branch: `chore/remove-unused-seller-workbench`
Base: `develop` at `a838e4001a1dcb5066713028aa22d8c1c2575280`

## Decision

The seller needs one maintained photo-to-listing workflow. The old
`src/app/seller-workbench.tsx` had no route or retained importer. Its comps
container, pricing views, jobs panel, and status badge formed a private,
unreachable component cluster. Maintaining a second implementation had no
current product benefit. Delete it instead of refactoring it.

Removed seven files (2,678 lines), including five tests specific to the retired
UI. Updated README guidance to the current seller interface. Active routes,
shared libraries, marketplace safety checks, pricing calculations, job APIs,
dependencies, and database schema were not changed. No runtime speedup is claimed.

## Validation

- Repository-wide source/script searches found no remaining references to the
  deleted modules or exported component/helper names.
- `npm run validate:full` passed using the committed CI workflow's non-secret
  placeholder environment: 236 test files, 1,713 tests; TypeScript, Prisma
  validation, and production build passed. ESLint returned zero errors and two
  unused-variable warnings in the unchanged draft-actions test.
- `git diff --check` passed.
- Independent review by `review_legacy_removal` approved the deletion with no
  blockers after checking static and dynamic references, scripts, configuration,
  filesystem readers, route reachability, security, accessibility, performance,
  architecture, and retained test coverage. Its README wording correction was
  applied.

Validation does not include authenticated browser testing or live service calls.
This is a local branch change; no merge, push, or deployment was performed.
