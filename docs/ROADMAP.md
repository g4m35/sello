# Roadmap

Phases are sequential but may overlap at the edges. Nothing in a later phase may fake the behavior of an unbuilt phase (no simulated publishing, no invented comps).

## Phase 1 — Listing workbench (current)

- Auth, photo upload, Gemini identification, Zod-validated structured drafts.
- Editable drafts: autosave, reset-to-AI-draft, duplicate, required-field validation.
- Marketplace draft previews (eBay, Grailed, Poshmark, Depop) — preview only.
- Item lifecycle states (draft/ready/active/sold/delisted/error).

## Phase 2 — Pricing / comps

- Manual price comps (source, title, price, shipping, sold_date, url, condition, notes).
- Calculations: low / average / high comp, quick-sale price, recommended list price.
- Confidence rating from comp count and similarity.
- No AI-invented prices. Active listings are not treated as proof of value unless clearly labeled.

## Phase 3 — eBay publishing

- eBay sandbox OAuth, token encryption at rest, readiness checks.
- Guarded publish path (disabled by default; sandbox-only behind an explicit flag).
- Publish attempts persisted as typed outcomes; failures are visible, never faked.

## Phase 4 — Inventory sync

- Sold detection, delisting, double-sell prevention.
- Idempotent inventory state transitions via background jobs.

## Phase 5 — Multi-marketplace publishing

- Grailed, Poshmark, Depop adapters behind the common interface.
- Official APIs where available; Playwright automation only where no API exists, with explicit guardrails and `manual_action_required` flows.

## Later quality gates (not yet scheduled)

- **CodeQL code scanning** — add once the repo is public or GitHub Advanced Security is enabled (not available on a private free repo).
- **Native secret scanning + push protection** — enable alongside CodeQL under the same conditions. Gitleaks covers secret scanning until then.
- **Lighthouse CI** — add as a UI-quality gate once a stable preview URL exists.
- **Codecov** — add once a coverage script is in place.
- **Sentry** — add after the MVP is deployed and there is a real runtime to monitor.
- **End-to-end tests** — once at least one real publishing path exists.
