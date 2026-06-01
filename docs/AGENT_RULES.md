# Agent Rules

Rules for AI coding agents (and humans) working in this repository. These complement [AGENTS.md](../AGENTS.md) and [CLAUDE.md](../CLAUDE.md); if anything conflicts, the stricter rule wins.

## Hard rules

- **Do not fake marketplace publishing.** Never simulate a successful publish, listing creation, or inventory sync. Unbuilt integrations return typed `NOT_IMPLEMENTED` / explicit failure outcomes.
- **Do not expose secrets.** Never log, print, echo, hardcode, or commit keys, tokens, or credentials. Use env vars; examples use placeholders only.
- **Do not change the database schema without a migration.** Edit `prisma/schema.prisma` and add a Prisma migration in the same change. Never hand-edit the database or skip the migration.
- **Do not skip tests.** Add or update tests for business logic. Do not delete or disable tests to make a build pass.
- **Do not touch unrelated files.** Keep changes scoped to the task. No drive-by refactors of app logic.
- **Do not push without explicit instruction.** Commits are allowed after verification passes; pushes and deploys require explicit human approval. Never push `main`. No auto-deploy.

## Code structure

- **API routes stay thin.** Route handlers validate input, call into `src/lib`, and shape responses. No business logic in route handlers.
- **Business logic goes in `src/lib`.** Pricing, AI orchestration, marketplace mapping, and lifecycle transitions are testable modules.
- **Zod validates all AI and external API outputs.** Nothing consumes Gemini or marketplace responses before Zod accepts them. Store raw and parsed outputs.
- **Marketplace failures must be persisted as typed outcomes.** No silent catches. A failed publish/sync is recorded as a typed, visible result that can be debugged.

## Pricing

- Never use Gemini (or any model) to invent resale prices.
- Pricing comes from user-entered comps and deterministic math. The user can override.

## Verification before completion

Run and confirm all pass before claiming done or committing:

```bash
npm run lint
npm test
npx prisma validate
npm run build
```

## Workflow

- Work in the correct `feature/*` branch and isolated worktree for the task area (see [WORKTREES.md](../WORKTREES.md)).
- One agent per worktree. Never run migrations simultaneously across worktrees.
- Merge flow: `feature/*` → `develop` → `main` → production.
- Report the chosen worktree/branch and reason before coding; report results honestly (including failures) when done.
