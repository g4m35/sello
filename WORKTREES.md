# Worktree Workflow

This repository uses `develop` for active integration and sibling git worktrees for isolated AI-agent feature work. Production deploys must never happen automatically from active development.

## Current Branch Structure

- `main`: production-safe state only. Do not push without explicit approval.
- `develop`: active integration branch for completed and verified feature work.
- `feature/lifecycle`: item lifecycle states and related domain workflow.
- `feature/adapters`: marketplace adapter planning and implementation.
- `feature/publishing`: publishing workflow foundations. Keep draft-only until real adapters/jobs exist.
- `feature/inventory-sync`: inventory synchronization planning and implementation.
- `feature/playwright`: Playwright automation for cases where official marketplace APIs are unavailable.
- `feature/ui`: user interface work and interaction polish.

## Current Worktrees

- `../worktrees/lifecycle` -> `feature/lifecycle`
- `../worktrees/adapters` -> `feature/adapters`
- `../worktrees/publishing` -> `feature/publishing`
- `../worktrees/inventory-sync` -> `feature/inventory-sync`
- `../worktrees/playwright` -> `feature/playwright`
- `../worktrees/ui` -> `feature/ui`

## Worktree Router

Agents must choose and report the safest worktree before coding. The authoritative router rules live in `AGENTS.md` under `Worktree Router Skill`.

Use this routing matrix:

| Area | Use for | Path | Branch |
| --- | --- | --- | --- |
| develop/main repo | migration verification, docs, small fixes, dependency cleanup, final integration testing, merging feature branches, branch/worktree maintenance | `/Users/jheller/Desktop/perc 30/resale-crosslister` | `develop` |
| lifecycle | item states, draft/ready/active/sold/delisted/error logic, readiness validation, lifecycle tests, status badges | `/Users/jheller/Desktop/perc 30/worktrees/lifecycle` | `feature/lifecycle` |
| adapters | marketplace adapter interfaces, eBay/Grailed/Poshmark/Depop field mapping, typed NOT_IMPLEMENTED responses, platform validation, marketplace account placeholders | `/Users/jheller/Desktop/perc 30/worktrees/adapters` | `feature/adapters` |
| publishing | real eBay publishing later, OAuth, publish jobs, listing creation, confirmation modal, publish queue wiring | `/Users/jheller/Desktop/perc 30/worktrees/publishing` | `feature/publishing` |
| inventory-sync | sold detection, delisting logic, double-sell prevention, inventory reconciliation, sync jobs, idempotent inventory state transitions | `/Users/jheller/Desktop/perc 30/worktrees/inventory-sync` | `feature/inventory-sync` |
| playwright | browser automation scaffolding, session handling, screenshot-on-failure, manual_action_required flows, automation guardrails | `/Users/jheller/Desktop/perc 30/worktrees/playwright` | `feature/playwright` |
| ui | dashboard polish, mobile layout, empty/loading/error states, navigation, editor UX, inventory/pricing page visuals | `/Users/jheller/Desktop/perc 30/worktrees/ui` | `feature/ui` |

Router safety rules:

- If task is ambiguous, stop and recommend the safest worktree.
- If task touches multiple areas, split it into separate worktree tasks.
- If task touches database migrations, use `develop` unless explicitly assigned otherwise.
- If task touches real publishing, OAuth, Playwright, or inventory sync, never work on `develop` directly.
- If currently in the wrong worktree, stop and tell the user the correct path/branch.
- Never switch branches with uncommitted work.
- Never delete a worktree with uncommitted work.
- Never push `main`.
- Never deploy.
- Always report selected worktree and reason before coding.

## Safe Workflow Rules

- Use git worktrees for isolated feature development.
- One agent per worktree.
- Never run multiple agents in the same worktree simultaneously.
- Keep each worktree scoped to its feature area.
- Risky systems, including publishing, inventory sync, adapters, auth, billing, and Playwright automation, must use feature branches.
- Database migrations route through `develop` unless explicitly assigned otherwise.
- Never deploy automatically.
- Never push `main` without explicit approval.
- Never run migrations simultaneously across worktrees.
- Do not change production settings from feature worktrees.

## Merge Flow

Use this flow for normal development:

```text
feature/* -> develop -> main -> production
```

Feature branches should be merged into `develop` only after verification passes. `develop` should be merged into `main` only when the state is production-safe and explicitly approved. Production deploys require explicit user approval.

## Agent Coordination Rules

- Assign exactly one agent to a worktree at a time.
- Agents should announce which worktree and branch they are using before making changes.
- Agents should avoid editing files owned by another active worktree unless coordination is explicit.
- Before pushing any branch, run:
  - `npm run lint`
  - `npm test`
  - `npx prisma validate`
  - `npm run build`
- If schema migrations are needed, coordinate them through a single worktree and do not run migration commands in parallel.

## Common Commands

List worktrees:

```bash
git worktree list
```

Create a feature branch and worktree from `develop`:

```bash
git worktree add -b feature/example ../worktrees/example develop
```

Open an existing worktree:

```bash
cd ../worktrees/example
```

Refresh a feature branch with the latest `develop`:

```bash
git fetch origin
git merge --ff-only develop
```

Remove a completed worktree:

```bash
git worktree remove ../worktrees/example
```

Prune stale worktree metadata:

```bash
git worktree prune
```
