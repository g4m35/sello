# Local development rules

## Recommended: Conductor

1. Open Conductor and select Sello.
2. Create a workspace (setup runs `npm ci` + Prisma generate).
3. Choose a model and type a normal product request.
4. Use Run → Start Sello for the app preview.
5. Use Diff, Checks, Review, Create PR, Merge, and Archive.

You do not need to manage worktrees, branches, task YAML, or `agent:*` commands for ordinary work. Details: `docs/operations/conductor-development.md`.

## Manual fallback

Use the canonical clone at `~/dev/resale-crosslister-clean` only to inspect/integrate repository state and to start isolated tasks. Never develop from the archived iCloud checkout.

```bash
npm ci
npm run agent:start -- <task-id-or-file>
npm run agent:status
```

Do not switch the canonical checkout to start a task. `agent:start` fetches `origin`, validates the contract, and safely creates or reuses the declared task worktree. Inside Conductor it adopts the current workspace instead.

Before completion outside Conductor, use:

```bash
npm run agent:check -- <task-id>
npm run agent:finish -- <task-id>
npm run agent:review -- <task-id>
```

GitHub CI is the final authority. Deployment remains a separate, explicitly authorized operation.
