# Multi-agent development workflow

Conductor is the recommended primary interface. See `docs/operations/conductor-development.md` first.

This document covers the two operating modes and the manual CLI/contract system that remains available for agents and high-risk work.

## Modes

### Conductor-native (default)

- Conductor already provides branch and worktree isolation.
- Agents must not run `agent:start` to create another worktree.
- Users do not create task files or operate the CLI for ordinary work.
- Task contracts are optional for low-risk bounded work.
- Task contracts remain required or strongly recommended for Prisma migrations, billing, authentication, marketplace publishing, inventory synchronization, production configuration, destructive refactors, and cross-system architecture changes.
- Inside Conductor, `agent:start` adopts the current workspace; `agent:check` / `agent:finish` / `agent:review` operate there; `agent:cleanup` refuses Conductor-managed workspaces.
- Conductor Diff, Checks, Review, Fix, Create PR, Merge, and Archive are the normal interface.

### Manual / non-Conductor (fallback)

Sello treats repository state as the shared brain. Every implementation is anchored to an exact Git base, a machine-readable contract, one branch, one worktree, one primary owner, deterministic evidence, an independent review, and GitHub CI.

## Roles

- Codex normally plans contracts, reviews full diffs, repairs valid findings when authorized, integrates the latest base, opens/updates PRs, and treats CI as final authority.
- Cursor/Grok normally implements bounded frontend or feature tasks inside an assigned worktree or Conductor workspace.
- Other agents can join by accepting the same model-independent contract and evidence requirements. Their model/vendor does not alter path or authorization boundaries.
- One agent is the primary implementation owner for a task. Multiple agents do not independently edit the same branch or worktree; divide parallel work into non-overlapping task contracts.

## Canonical checkout versus task worktrees

The canonical clone is the repository/control point. It is used to inspect state, create worktrees, review, and integrate. Product implementation happens in Conductor workspaces or contract-owned worktrees under `~/dev/`. Outside Conductor, `agent:start` fetches remote refs without moving a local integration branch, then creates the task branch from the current `origin/<base_branch>` commit. Inside Conductor it adopts the current workspace.

Every pre-existing worktree, branch, uncommitted file, and unknown file belongs to its current owner. Never switch, stash, reset, clean, rebase, merge, commit, or edit another worktree to make a task convenient.

## End-to-end workflow

### 1. Define the task

Translate the user request into one bounded goal with explicit non-goals, risk, owner, reviewer, acceptance criteria, and authorization. Split unrelated or path-overlapping work before assignment.

### 2. Create the task contract

Copy `.agent/templates/task.yaml` to `.agent/tasks/backlog/<task-id>.yaml`, fill every field, validate the branch/path, and commit it to the integration branch through the normal review path. Contracts use repository-relative glob patterns for `allowed_paths` and `protected_paths`.

### 3. Create the worktree

From a safe repository worktree:

```bash
npm run agent:start -- <task-id-or-file>
```

The command fetches `origin`, verifies the base, checks existing branches/worktrees, safely reuses only an exact match, creates the branch/worktree when safe, moves the contract to active state in the task branch, records the base commit under `.agent/state/`, and prints the exact assigned path. Mutating actions take a task-specific lock in Git's shared metadata so two worktrees cannot start, finish, review, or clean the same task concurrently. Commit the start metadata before implementation.

### 4. Assign the agent

Use `.agent/templates/cursor-task-prompt.md` or the appropriate model-independent prompt. The assignee reads root and nested `AGENTS.md`, the active contract, and `required_reading`; verifies `pwd`, branch, and worktree; then states the accepted scope before editing.

### 5. Implement

The primary owner changes only allowed paths. Sensitive backend work requires explicit protected-system authorization. Ordinary errors, repository differences, and test failures are investigated and repaired; they are not reasons to abandon the task. No agent discards unknown work or expands scope silently.

### 6. Run scoped validation

Run focused commands during development, then the exact `validation` array in the contract. `npm run validate:scoped` is the common fast gate; backend contracts add focused safety tests. A UI task should not run live provider/marketplace/database actions, and it need not run the slowest integration gate on every iteration.

### 7. Generate completion evidence

Commit implementation changes, ensure the worktree is clean, then run:

```bash
npm run agent:check -- <task-id>
npm run agent:finish -- <task-id>
```

`agent:check` verifies identity, base/merge-base, changed paths, protected paths, secret files/patterns, conflict markers, dirty state, metadata, and authorizations. `agent:finish` runs every declared command and writes `.agent/completed/<task-id>.md` with real hashes, paths, timestamps, exit codes, and sanitized output summaries. Failed validation produces BLOCKED evidence and a nonzero exit; it never fabricates completion.

Commit the generated completion contract/state/report as a separate evidence commit.

### 8. Perform independent review

The named reviewer uses `.agent/templates/codex-review-prompt.md` and runs:

```bash
npm run agent:review -- <task-id>
```

The command creates the full diff artifact and structured report under `.agent/reviews/`, reruns path policy and declared validation, and remains NOT MERGE READY until a semantic reviewer has inspected functional behavior, security, architecture, accessibility, performance, tests, and UX. Supply `--approve` only after that review is genuinely complete and all required findings are resolved.

### 9. Repair loop

Record findings as P0-P3 with file/line, failure scenario, and required correction. The authorized implementation owner or reviewer fixes valid findings on the task branch, commits, reruns scoped/full validation as required, regenerates completion evidence, and updates the review. P0/P1 and required P2 findings block merge.

### 10. Integrate the latest base

Fetch `origin` and compare the task branch with current `origin/<base_branch>`. Rebase or merge only in the task worktree according to the contract/reviewer decision. Resolve each conflict semantically by understanding both changes and their tests. Never choose all `ours` or all `theirs`; preserve both intended behaviors or document why one is obsolete. Rerun scope checks after conflict resolution.

### 11. Run full validation

When `full_validation_required: true`, run:

```bash
npm run validate:full
```

This generates Prisma types, lints, typechecks, runs the full Vitest suite (including marketplace, billing, inventory-sync, auth, security, and migration coverage), validates Prisma syntax, and builds the Next.js application. It does not run a production migration or live external action.

### 12. Open or update the PR

Target the task's declared base branch. Include the problem, workflow/implementation architecture, changed files, tests and exact commands, safety behavior, migration/product/deployment impact, limitations, rollback, and links to contract/completion/review evidence. Do not merge merely because the PR exists.

### 13. Verify CI

GitHub Actions is the final authority. Required checks validate agent policy, workflow tests, lint, typecheck, full tests, Prisma, build, and secret scanning. Inspect failures, repair introduced problems, and prove any pre-existing failure against the exact untouched base. Never waive or relabel failures for convenience.

### 14. Merge

Merge only when `merge_authorized: true`, required findings are resolved, completion/review evidence matches the reviewed commit, and required CI is green. Codex normally performs or supervises integration. Merging to `develop` does not authorize promotion to `main`.

### 15. Clean up

After the task is complete, pushed, merged, and clean:

```bash
npm run agent:cleanup -- <task-id>
```

The command refuses dirty, unpushed, unmerged, or incomplete work. It removes only the declared worktree and prunes metadata; it does not delete an unmerged branch by default. `--dangerous` is an explicit human recovery override, not a normal path.

### 16. Authorize deployment separately

Deployment has its own task/approval window. Recheck environment-name coverage, migration order, auth/protection walls, live readiness, rollback, and non-destructive smoke scope. Never infer deployment permission from merge permission or a green build.

## Why the repository is the shared brain

Chat history, agent memory, and handoff prose drift. Commits and exact diffs identify what exists; contracts identify authorized intent; architecture and ADRs identify durable boundaries; tests and evidence identify what was actually exercised; CI identifies the reviewed revision. `HANDOFF.md` can help orient a human but cannot override these sources.

## Conflict handling

1. Preserve both worktrees and all uncommitted files.
2. Determine each side's task contract, base, intended behavior, and tests.
3. Reproduce the conflict in the integrating task worktree only.
4. Merge the semantics, not the text markers.
5. Add or repair tests for both intended behaviors.
6. Rerun path checks and validation.
7. Record the resolution and any deferred overlap in completion/review evidence.

If two active tasks modify the same instruction/workflow file, finish them independently and flag the overlap for later semantic integration; never overwrite the other task's checkout.

## Pre-existing failures

A failing command is unclassified until the same command (or a justified equivalent) is run at the exact untouched base revision. Evidence must include command, base hash, exit code, and relevant sanitized summary. Fix safe in-scope failures. If the failure is genuinely pre-existing and outside scope, record it precisely; never silently omit the command or call the task complete when the contract requires it to pass.

## Risk-specific expectations

- UI/frontend: narrow page/component paths, backend protected, responsive and reduced-motion states, keyboard/focus/semantic checks, screenshots or visual comparison where supported, no functionality regression.
- Backend/API: account-scope denial tests, typed boundary errors, no secret leakage, idempotency where side effects exist.
- Marketplace/inventory/billing/auth/provider: explicit sensitive paths, high-risk review, disabled/unauthorized/race/failure tests, no live calls, full validation.
- Database/operations/deployment: forward-safe plan, rollback/mitigation, authorization, exact environment boundaries, and separate production action.

## Git hooks and bypasses

This repository intentionally does not set a shared `core.hooksPath`: Git config is common to all worktrees and changing it during concurrent work could disrupt protected tasks or emergency recovery. The equivalent deterministic safeguards live in `agent:check`, `agent:finish`, and required CI. Explicit recovery bypasses are narrow and visible (`agent:cleanup --dangerous`); they never convert failed evidence into success.
