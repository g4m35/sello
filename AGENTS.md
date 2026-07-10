<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Sello Agent Operating Rules

This file is the canonical instruction source for every coding agent. Git history, repository code, tests, architecture documents, ADRs, task contracts, completion records, review records, and GitHub CI are authoritative. `HANDOFF.md` is informational only and may be stale.

## Primary interface: Conductor

Day-to-day Sello development should happen in Conductor:

1. Open Conductor → select Sello → create a workspace → choose a model → type a normal product request.
2. Use Conductor Diff, Checks, Review, Create PR, Merge, and Archive.
3. Do not ask the user to manage worktrees, branches, task YAML, completion reports, or `agent:*` commands.

See `docs/operations/conductor-development.md`. The Conductor workspace is already the isolated task worktree — never create a nested worktree inside it.

## Repository and architecture map

- Canonical clone: `~/dev/resale-crosslister-clean`; the `perc 30/resale-crosslister` workspace path is a symlink to it.
- Never develop in `resale-crosslister-ARCHIVED-NO-GIT`.
- Conductor workspaces are the default isolated worktrees. Manual task worktrees under `~/dev/` remain supported outside Conductor via `npm run agent:start`.
- `src/app/`: Next.js App Router pages, layouts, and route handlers.
- `src/components/`: reusable product and app UI.
- `src/lib/ai/`: Gemini request/response boundaries and Zod validation.
- `src/lib/billing/`: accounts, memberships, Stripe, plans, entitlements, and usage.
- `src/lib/comps/`: comp providers, matching, budgets, quotas, cooldowns, and kill switches.
- `src/lib/marketplace/`: capability registry, publish/delist orchestration, and marketplace adapters.
- `src/lib/inventory/` and `src/lib/inventory-sync/`: sold-state safety, audit events, review tasks, delist jobs, and workers.
- `src/lib/auth/`: authentication-adjacent authorization and feature access.
- `prisma/`: schema and forward-only migration history.
- `.agent/`: optional/manual task contracts, state, completion evidence, review evidence, and reusable prompts.
- `.conductor/`: shared Conductor setup, Run actions, and permanent prompts.
- `docs/architecture/` and `docs/operations/`: verified system design and operating procedures.

The fuller architecture map is in `docs/architecture/overview.md`; mandatory guarantees are in `docs/architecture/invariants.md`.

## Toolchain and commands

- Package manager: npm, using the committed `package-lock.json`.
- Install: `npm ci` for reproducible installs; use `npm install` only when intentionally changing dependencies.
- Develop: `npm run dev` (or Conductor Run → Start Sello with `$CONDUCTOR_PORT`).
- Focused tests: `npm test -- --run <test-files>`.
- Fast repository gate: `npm run validate:scoped`.
- Full integration gate: `npm run validate:full`.
- Prisma syntax only: `npm run prisma:validate`.

Do not run `db:migrate`, `db:deploy`, production provider calls, live marketplace actions, or deploy commands as validation.

## Task contracts

Task contracts are optional for low-risk bounded Conductor work. They remain required or strongly recommended for Prisma migrations, billing, auth, marketplace publishing, inventory sync, production configuration, destructive refactors, and cross-system architecture changes.

When a contract is used, it lives under `.agent/tasks/` and defines owner, reviewer, branches, worktree, allowed/protected paths, acceptance, validation, and authorization. Inside Conductor, `agent:start` adopts the current workspace and must never create a nested worktree. Outside Conductor, the manual CLI remains available:

```bash
npm run agent:start -- <task-id-or-file>
npm run agent:status
npm run agent:check -- <task-id-or-file>
npm run agent:finish -- <task-id-or-file>
npm run agent:review -- <task-id-or-file>
npm run agent:cleanup -- <task-id-or-file>
```

JSON is available with `--json`. `agent:cleanup` never deletes a Conductor-managed workspace; use Conductor Archive after merge.

## Branches, worktrees, and ownership

- Integration branch: `develop`. Production branch: `main`.
- Branch names: `feature/*`, `fix/*`, `chore/*`, `security/*`, `docs/*`, or `test/*`.
- Exactly one primary implementation owner and one dedicated worktree/workspace per task.
- Never edit in the canonical integration checkout for a feature task.
- Never share one worktree between concurrent agents.
- Never switch, reset, clean, stash, rebase, merge, commit, or discard work in another task's worktree.
- Never reuse an occupied branch or path for an unrelated task.
- Never silently expand beyond `allowed_paths` when a contract is active.
- `protected_paths` are a hard stop unless the contract is explicitly revised by an authorized owner.

## Commit, review, integration, and definition of done

- Commit coherent implementation changes on the task/workspace branch. Do not mix unrelated cleanup.
- Before claiming completion, review the full diff, fix introduced failures, and run required validation.
- Independent review (Conductor Review or `agent:review`) must inspect functional behavior, security, architecture, accessibility, performance, and tests.
- Integrate the latest base semantically. Never resolve a conflict by blindly choosing `ours` or `theirs`.
- Do not call a failure pre-existing without a clean-base run or equivalent exact evidence.
- GitHub CI is the final merge authority. Local success is necessary but not sufficient.
- Never deploy without explicit authorization. Never merge high-risk work without independent review.

## Security and protected systems

- Never expose, log, paste, or commit environment values, marketplace credentials, OAuth tokens, billing secrets, provider payloads containing secrets, private keys, or database credentials.
- Never commit `.env` files. `.env.example` may contain names and obvious placeholders only.
- All external and AI data is untrusted and must be validated at the boundary.
- Sensitive backend systems may be edited only when explicitly authorized: `prisma/`, auth, billing, marketplace adapters and live actions, inventory synchronization, provider budgets, CI/deployment, and secret-handling code.
- Never weaken account isolation, feature/entitlement checks, readiness gates, idempotency, transaction boundaries, provider controls, sanitization, or audit trails for UI convenience.
- Never fake marketplace publishing, delisting, price comps, validation success, or completion evidence.
- Use the product term "listing", never "marketplace-ready draft".

Narrower instructions in nested `AGENTS.md` files apply within sensitive directories.

## Database and migrations

- Use Prisma for database access.
- Schema or migration changes require high-risk review, focused migration tests, `npm run prisma:validate`, and the full integration gate.
- Migrations must be additive or otherwise forward-safe, auditable, and have a documented rollback/mitigation path.
- Never edit an already-applied migration to rewrite history.
- Never run production migrations without explicit owner approval.

## Deployment and merge authorization

- Never deploy merely because a task merged. Deployment is a separate, explicitly authorized operation.
- Never push `main` or deploy production without explicit owner approval.

## Mandatory Sello invariants

1. All seller-owned data remains account-scoped.
2. Marketplace operations fail closed.
3. Publishing requires server-side readiness validation.
4. Publishing and delisting remain idempotent.
5. Sold-state transitions and required delisting jobs remain transactionally safe.
6. Marketplace credentials, tokens, secrets, and environment values are never logged or committed.
7. Billing and entitlement enforcement occurs server-side.
8. Provider budget/quota controls remain enforced.
9. AI and external payloads are Zod-validated at boundaries.
10. Validation and job failures are visible; never silently swallowed.
