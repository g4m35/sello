# Local development rules

Use the canonical clone at `~/dev/resale-crosslister-clean` only to inspect/integrate repository state and to start isolated tasks. Never develop from the archived iCloud checkout.

All implementation work must follow `AGENTS.md`, a machine-readable task contract, and the worktree workflow in `docs/operations/multi-agent-development.md`.

```bash
npm ci
npm run agent:start -- <task-id-or-file>
npm run agent:status
```

Do not switch the canonical checkout to start a task. `agent:start` fetches `origin`, validates the contract, and safely creates or reuses the declared task worktree.

Before completion, use the contract-specific validation and evidence commands:

```bash
npm run agent:check -- <task-id>
npm run agent:finish -- <task-id>
npm run agent:review -- <task-id>
```

GitHub CI is the final authority. Deployment remains a separate, explicitly authorized operation.
