# Local development rules

## Native worktree workflow

Use the canonical clone at `~/dev/resale-crosslister-clean` only to inspect/integrate repository state and to start isolated tasks. Never develop from the archived iCloud checkout.

```bash
npm ci
npm run agent:start -- <task-id-or-file>
npm run agent:status
```

Do not switch the canonical checkout to start a task. For contracted work, `agent:start` fetches `origin`, validates the contract, and safely creates or reuses the declared task worktree. For ordinary bounded work, Codex may create the same isolation directly with `git worktree add` after inspecting every registered worktree and protecting dirty checkouts.

Before completing a contracted task, use:

```bash
npm run agent:check -- <task-id>
npm run agent:finish -- <task-id>
npm run agent:review -- <task-id>
```

GitHub CI is the final authority. Deployment remains a separate, explicitly authorized operation.
