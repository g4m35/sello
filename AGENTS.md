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
