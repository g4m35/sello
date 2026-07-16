# Worktree workflow

Sello prefers Conductor workspaces for day-to-day isolation. Manual Git worktrees remain available outside Conductor.

## Conductor-native (recommended)

Conductor creates an isolated workspace and branch for each task. Agents must treat that workspace as the task worktree and must not run `agent:start` to create another nested worktree. Archive through Conductor after merge; `agent:cleanup` refuses Conductor-managed paths.

See `docs/operations/conductor-development.md`.

## Manual worktrees (fallback)

```text
canonical clone / integration inspection
  ├── task worktree A → one branch → one implementation owner
  ├── task worktree B → one branch → one implementation owner
  └── reviewer/integrator → evidence + CI → develop
```

Create worktrees through the repository CLI only when not using Conductor:

```bash
npm run agent:start -- <task-id-or-file>
```

The command fetches without moving another local branch, validates branch/path state, refuses unrelated collisions, records the exact base commit, and prints the assigned worktree. Never switch, stash, reset, clean, merge, or delete another task's worktree. Cleanup is allowed only through `npm run agent:cleanup -- <task-id>` after the task is complete, pushed, merged, and clean; destructive exceptions require explicit `--dangerous` intent.

Branch flow remains `feature/*|fix/*|chore/*|security/*|docs/*|test/* → develop → main → production`. Merge and deployment are separate authorizations.
