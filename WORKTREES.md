# Worktree workflow

Sello uses native Git worktrees for task isolation.

```text
canonical clone / integration inspection
  ├── task worktree A → one branch → one implementation owner
  ├── task worktree B → one branch → one implementation owner
  └── reviewer/integrator → evidence + CI → develop
```

For high-risk or explicitly contracted tasks, create worktrees through the repository CLI:

```bash
npm run agent:start -- <task-id-or-file>
```

The command fetches without moving another local branch, validates branch/path state, refuses unrelated collisions, records the exact base commit, and prints the assigned worktree. A bounded task may also use an equivalent worktree created directly with `git worktree add` after the same collision and dirty-state checks. Never switch, stash, reset, clean, merge, or delete another task's worktree. Cleanup is allowed only after the task is complete, pushed, merged, and clean; `npm run agent:cleanup -- <task-id>` enforces those checks for contracted tasks, and destructive exceptions require explicit `--dangerous` intent.

Branch flow remains `feature/*|fix/*|chore/*|security/*|docs/*|test/* → develop → main → production`. Merge and deployment are separate authorizations.
