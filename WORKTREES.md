# Worktree Workflow

Use **one canonical clone** and optional sibling worktrees. Never develop from the archived Desktop checkout.

## Canonical paths

| Role | Path | Notes |
| --- | --- | --- |
| Primary clone | `~/dev/resale-crosslister-clean` | Real git repo. Default for agents. |
| Workspace symlink | `~/Desktop/perc 30/resale-crosslister` | Symlink → primary clone (so `perc 30` chats stay consistent). |
| Archived (do not use) | `~/Desktop/perc 30/resale-crosslister-ARCHIVED-NO-GIT` | Old iCloud checkout with **no `.git`**. |

## Branch structure

- `main`: production-safe only. Do not push without explicit approval.
- `develop`: active integration.
- `feature/*`, `fix/*`, `chore/*`, `security/*`: short-lived work.

## Merge flow

```text
feature/* → develop → main → production
```

Never deploy automatically. Production deploys require explicit owner approval.

## Worktrees (current)

Create worktrees **under `~/dev/`**, not on iCloud Desktop:

```bash
cd ~/dev/resale-crosslister-clean
git fetch origin
git worktree add ../resale-crosslister-<topic> -b feature/<topic> origin/develop
```

| Area | Use for | Suggested path |
| --- | --- | --- |
| develop | migrations, deps, docs, integration | `~/dev/resale-crosslister-clean` or `~/dev/resale-crosslister-safety` |
| ui / polish | dashboard, marketing, visual polish | `~/dev/resale-crosslister-ui` |
| billing | Stripe / plans / metering | `~/dev/resale-crosslister-billing` |
| marketplaces | adapters, OAuth, publish | `~/dev/resale-crosslister-marketplaces` |
| comps | pricing comps / providers | `~/dev/resale-crosslister-comps` |

## Safety rules

- One agent per worktree.
- Never switch branches with uncommitted work.
- Never delete a worktree with uncommitted work.
- Migrations and dependency bumps: from `develop` (or a `chore/*` cut from `develop`).
- Risky systems (publishing, inventory sync, Playwright, billing): feature branches only.
- Never push `main` without approval.

## Router

If the task is ambiguous, stop and pick the safest worktree. If it spans areas, split into separate worktree tasks.
