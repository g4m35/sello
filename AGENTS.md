<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agent Operating Rules

## Canonical repo

Work only in `~/dev/resale-crosslister-clean`. Under the Cursor workspace
`perc 30`, `resale-crosslister` is a symlink to that path. Never develop in
`resale-crosslister-ARCHIVED-NO-GIT` (old iCloud checkout, no `.git`).

## Session Handoff (read first, update last)

This project alternates between Codex and Claude agents (the owner switches due to
usage limits), so you start with no memory of the previous session. **Read
`HANDOFF.md` at the start of every session** for the live state, and **update
`HANDOFF.md` before finishing** (Last updated, a dated Recent-work bullet, Current
state, Blocked-on-owner, Next up). Keep it accurate; never put secrets in it.
Older history lives in `docs/history/`.

## Mission

Build a production-grade AI resale cross-listing SaaS toward launch. The core
workflow is stable; the work now is completing the real platform on top of it:

Upload photos → Gemini identifies item → structured listing draft → user edits &
approves → automatic pricing from real comps → cross-list to marketplaces → keep
inventory in sync → monetize.

Build complete features, not placeholders. The earlier "small MVP, don't expand
scope" framing is retired.

## Product Scope

In scope:

- Photo upload, Gemini identification, Zod-validated structured outputs
- Editable listing drafts, autosave, lifecycle states
- Automatic pricing from real comp data sources
- Real marketplace publishing behind capability-gated adapters
- Marketplace OAuth, publish jobs, inventory sync
- Paid subscriptions (Stripe)
- Background jobs / workers

Out of scope (for now):

- Mobile-native app
- Social features
- AI sourcing intelligence
- Scraping as a primary integration (Playwright only where no official API exists)

## Non-Negotiables (integrity — never violate)

- Never fake successful marketplace publishing; a channel without a real adapter
  returns a typed NOT_IMPLEMENTED outcome.
- Real publishing must call the marketplace API and reflect the true result.
- Never use Gemini to invent prices; never fabricate comps. Show "Needs comps"
  when there is no real data.
- Never publish or take destructive marketplace actions without explicit user intent.
- Never expose, log, or hardcode secrets.
- Never let one user access another user's data.
- Never silently ignore failed validation or failed jobs.

## Architecture Principles

- One master item drives all marketplace drafts/listings.
- Marketplace logic lives in adapters; the UI branches on capability flags, not ids.
- Pricing/business logic lives in pure, testable utilities.
- AI output is schema-validated before use; store raw + parsed.
- Jobs are idempotent; long/unreliable work runs in queues.
- Errors are typed and visible enough to debug.
- Prefer clear states over decoration.

## Required Verification

Before reporting completion, run:

```bash
npm run lint
npm test
npx prisma validate
npm run build
```

## Commit / Push / Deploy Policy

- Commit after the verification gate passes.
- Push only when explicitly requested.
- `main` is protected production state; never push `main` without explicit approval.
- Merge flow: `feature/*` -> `develop` -> `main` -> production.
- No automatic deploys. Production deploys only when explicitly requested; preview
  deploys are fine on request.
- Never expose or hardcode secrets.

# Git Worktree Workflow

Active worktrees:

- `/Users/jheller/Desktop/perc 30/resale-crosslister` — branch `develop` (integration:
  migrations, docs, small fixes, merges, branch maintenance).
- `/Users/jheller/Desktop/perc 30/worktrees/ui` — branch `feature/ui` (current
  feature work; broadly used for app + backend changes).

The earlier per-area worktrees (lifecycle, adapters, publishing, inventory-sync,
playwright) were consolidated; recreate a dedicated `feature/*` worktree with
`git worktree add` when a large, risky workstream (e.g. real publishing, OAuth,
inventory sync, Playwright) warrants isolation.

Rules:

- One agent per worktree; never run two agents in the same worktree at once.
- Never run migrations simultaneously across worktrees; route migrations through `develop`.
- Feature work happens on `feature/*`; large risky systems get their own worktree.
- Never switch branches or delete a worktree with uncommitted work.
- Never push `main` without approval; never auto-deploy.
- Report the selected worktree/branch before coding.

## Learned User Preferences

- Scope deep audits and improvements to `resale-crosslister` only unless asked otherwise; go deep and change whatever is needed.
- For large reviews (security, efficiency, bugs) and structural cleanup, research and plan before implementing; keep the repo organized, clean, and well-made.
- Apply recommended fixes directly rather than only proposing them.
- Default bulk publish limit should be 10 listings.
- Prefer TypeScript for frontend work.
- When asked to open the app, open or preview it for the user; end conflicting local server processes before reloading.
- Keep listing/feature surfaces always on for testing — do not toggle listing forms off; treat listing severity as low while the app has no real users.
- Signed-in users should go straight into the Sello app, not the marketing landing; the landing page is for new/anonymous users only.
- Landing should clearly explain what Sello solves; use modern SaaS references (Linear, Stripe, Brilliant); prefer a clean in-page demo flow over clunky gimmicks.
- Abandoned the SVG morph-loader landing experiment after repeated outline/morph quality issues; do not revive it unless explicitly asked.

## Learned Workspace Facts

- Canonical app repo: `~/dev/resale-crosslister-clean` (git). Under the Cursor workspace `perc 30`, `resale-crosslister` is a symlink to that path.
- Do not develop in `resale-crosslister-ARCHIVED-NO-GIT` (old iCloud/Desktop checkout with no `.git`).
- Product brand/name is Sello (production host `sello.wtf`).
- Stack: Supabase Auth, Prisma, marketplace OAuth (eBay/Etsy/StockX), Stripe billing.
- Clerk auth/billing was researched and deferred — stay on Supabase Auth + Stripe for now (`docs/CLERK_AUTH_BILLING_RESEARCH.md`).
- Session handoff lives in `HANDOFF.md` / `AGENTS.md`; read at session start and update before finishing.
- Merge flow: `feature/*` → `develop` → `main` → production. Never push `main` or deploy without explicit owner approval.
- Always-on testing policy: admins get feature entitlements for comps/publish testing (`docs/ALWAYS_ON_TESTING_POLICY.md`); global kill-switches (e.g. `COMPS_PAID_PROVIDERS_ENABLED`, `EBAY_PRODUCTION_PUBLISH_ENABLED`) still apply.
