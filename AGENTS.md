<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Sello Agent Operating Rules

This file is the canonical instruction source for every coding agent. Git history, repository code, tests, architecture documents, ADRs, task contracts, completion records, review records, and GitHub CI are authoritative. `HANDOFF.md` is informational only and may be stale.

## Repository and architecture map

- Canonical clone: `~/dev/resale-crosslister-clean`; the `perc 30/resale-crosslister` workspace path is a symlink to it.
- Never develop in `resale-crosslister-ARCHIVED-NO-GIT`.
- Task worktrees: isolated siblings under `~/dev/`, created from the task contract by `npm run agent:start`.
- `src/app/`: Next.js App Router pages, layouts, and route handlers.
- `src/components/`: reusable product and app UI.
- `src/lib/ai/`: Gemini request/response boundaries and Zod validation.
- `src/lib/billing/`: accounts, memberships, Stripe, plans, entitlements, and usage.
- `src/lib/comps/`: comp providers, matching, budgets, quotas, cooldowns, and kill switches.
- `src/lib/marketplace/`: capability registry, publish/delist orchestration, and marketplace adapters.
- `src/lib/inventory/` and `src/lib/inventory-sync/`: sold-state safety, audit events, review tasks, delist jobs, and workers.
- `src/lib/auth/`: authentication-adjacent authorization and feature access.
- `prisma/`: schema and forward-only migration history.
- `.agent/`: task contracts, state, completion evidence, review evidence, and reusable prompts.
- `docs/architecture/` and `docs/operations/`: verified system design and operating procedures.

The fuller architecture map is in `docs/architecture/overview.md`; mandatory guarantees are in `docs/architecture/invariants.md`.

## Toolchain and commands

- Package manager: npm, using the committed `package-lock.json`.
- Install: `npm ci` for reproducible installs; use `npm install` only when intentionally changing dependencies.
- Develop: `npm run dev`.
- Focused tests: `npm test -- --run <test-files>`.
- Fast repository gate: `npm run validate:scoped`.
- Full integration gate: `npm run validate:full`.
- Prisma syntax only: `npm run prisma:validate`.

Do not run `db:migrate`, `db:deploy`, production provider calls, live marketplace actions, or deploy commands as validation.

## Task contract is required

Every agent-owned change uses one YAML contract in `.agent/tasks/active/`, created from `.agent/templates/task.yaml`. Read it before editing. It defines the owner, reviewer, base and working branches, worktree, allowed paths, protected paths, acceptance criteria, validation, and deployment/merge authorization.

Run these from the repository that contains the contract:

```bash
npm run agent:start -- <task-id-or-file>
npm run agent:status
npm run agent:check -- <task-id-or-file>
npm run agent:finish -- <task-id-or-file>
npm run agent:review -- <task-id-or-file>
npm run agent:cleanup -- <task-id-or-file>
```

JSON is available with `--json`. Use `--run-validation` with `agent:check` when validation should run. `agent:review` requires a real semantic review before `--approve` may be supplied. `agent:cleanup` is conservative; destructive overrides require the explicit `--dangerous` flag.

## Branches, worktrees, and ownership

- Integration branch: `develop`. Production branch: `main`.
- Branch names: `feature/*`, `fix/*`, `chore/*`, `security/*`, `docs/*`, or `test/*`.
- Exactly one primary implementation owner and one dedicated worktree per task.
- Never edit in the canonical integration checkout for a feature task.
- Never share one worktree between concurrent agents.
- Never switch, reset, clean, stash, rebase, merge, commit, or discard work in another task's worktree.
- Never reuse an occupied branch or path for an unrelated task.
- Never silently expand beyond `allowed_paths`; update the contract deliberately and obtain the required review.
- `protected_paths` are a hard stop unless the contract is explicitly revised by an authorized owner.
- Do not independently have several agents implement the same task. Parallel work must be split into non-overlapping contracts.

## Commit, review, integration, and definition of done

- Commit coherent implementation changes on the task branch. Do not mix unrelated cleanup.
- Commit task-start metadata before implementation, and commit completion/review evidence after the CLI generates it.
- Before `agent:finish`, the implementation worktree must be clean so the recorded Git hashes and diff are reproducible.
- `agent:finish` never merges and never deploys. A failed validation creates BLOCKED evidence and may not be described as complete.
- The reviewer must inspect the full base-to-head diff, path scope, functional behavior, security, data isolation, accessibility, performance, UX, and tests.
- Resolve review findings on the task branch when authorized, rerun validation, and update review/completion evidence.
- Integrate the latest base semantically. Never resolve a conflict by blindly choosing `ours` or `theirs`.
- Do not call a failure pre-existing without a clean-base run or equivalent exact evidence. Introduced and verified pre-existing failures must be distinguished.
- GitHub CI is the final merge authority. Local success is necessary but not sufficient.

A task is done only when acceptance criteria are met, declared validation passes, the completion record contains real commands/hashes/exit codes, independent review is complete, required CI is green, and deployment/merge authorization has not been exceeded.

## Security and protected systems

- Never expose, log, paste, or commit environment values, marketplace credentials, OAuth tokens, billing secrets, provider payloads containing secrets, private keys, or database credentials.
- Never commit `.env` files. `.env.example` may contain names and obvious placeholders only.
- All external and AI data is untrusted and must be validated at the boundary.
- Sensitive backend systems may be edited only when the contract explicitly allows them: `prisma/`, auth, billing, marketplace adapters and live actions, inventory synchronization, provider budgets, CI/deployment, and secret-handling code.
- Never weaken account isolation, feature/entitlement checks, readiness gates, idempotency, transaction boundaries, provider controls, sanitization, or audit trails for UI convenience.
- Never fake marketplace publishing, delisting, price comps, validation success, or completion evidence.

Narrower instructions in nested `AGENTS.md` files apply within sensitive directories.

## Database and migrations

- Use Prisma for database access.
- Schema or migration changes require `task_type: database` (or an explicitly authorized backend task), high-risk review, focused migration tests, `npm run prisma:validate`, and the full integration gate.
- Migrations must be additive or otherwise forward-safe, auditable, and have a documented rollback/mitigation path.
- Never edit an already-applied migration to rewrite history.
- Never run production migrations without explicit authorization in the active task contract and separate owner approval for the production action.

## Deployment and merge authorization

- `deployment_authorized: false` means no preview or production deployment. `true` authorizes only the scope stated in the contract.
- `merge_authorized: false` means do not merge, even when review and CI pass.
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
8. User-facing language says `listing`, never `marketplace-ready draft`.
9. Paid providers remain behind feature, quota, budget, cooldown, and kill-switch controls.
10. Existing marketplace safety behavior is never weakened for UI convenience.
11. Production migrations are forward-safe, auditable, and explicitly authorized.
12. Agents do not deploy unless the active task contract explicitly authorizes deployment.
13. Agents do not silently skip validation because failures appear pre-existing.
14. Agents distinguish introduced failures from verified pre-existing failures.
15. Agents resolve safe ordinary implementation challenges instead of stopping at them.
16. Agents never discard unknown work.
17. Agents never resolve merge conflicts by blindly choosing `ours` or `theirs`.
18. Sensitive backend systems are edited only when the task contract explicitly allows them.
19. Git history, code, tests, task contracts, architecture documentation, validation evidence, review evidence, and CI outrank handoff prose.
20. Every completed task has an evidence-backed completion record.

## Completion report requirements

Completion records live at `.agent/completed/<task-id>.md` and must include the task, owner/reviewer, branch/worktree, base/final commits, exact changed files, intended and unchanged behavior, acceptance results, exact commands and exit codes, output summaries, failure classification evidence, tests, review resolution, limitations, documentation, deployment/merge state, review focus, and timestamp.

Use `listing` for seller-facing concepts. Capability descriptions must state what the system truly does now, not a future ceiling or simulated success.
