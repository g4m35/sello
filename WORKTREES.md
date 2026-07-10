# Worktree workflow

Sello uses one canonical clone plus one isolated worktree per task. The contract under `.agent/tasks/` owns the branch and absolute worktree path; `AGENTS.md` and `docs/operations/multi-agent-development.md` are authoritative.

```text
canonical clone / integration inspection
  ├── task worktree A → one branch → one implementation owner
  ├── task worktree B → one branch → one implementation owner
  └── reviewer/integrator → evidence + CI → develop
```

Create worktrees through the repository CLI:

```bash
npm run agent:start -- <task-id-or-file>
```

The command fetches without moving another local branch, validates branch/path state, refuses unrelated collisions, records the exact base commit, and prints the assigned worktree. Never switch, stash, reset, clean, merge, or delete another task's worktree. Cleanup is allowed only through `npm run agent:cleanup -- <task-id>` after the task is complete, pushed, merged, and clean; destructive exceptions require explicit `--dangerous` intent.

Branch flow remains `feature/*|fix/*|chore/*|security/*|docs/*|test/* → develop → main → production`. Merge and deployment are separate authorizations.
