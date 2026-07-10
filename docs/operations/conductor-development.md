# Conductor development (primary)

Conductor is the recommended way to build Sello day to day. After this workflow lands, you should not normally manage worktrees, branches, task YAML, completion reports, review files, handoff files, or `agent:*` commands yourself.

## Primary flow

1. Open Conductor.
2. Select the Sello repository.
3. Create a workspace.
4. Select an implementation model (Codex GPT-5.6 when available, or another authenticated model).
5. Type a normal product request once.
6. Watch progress, open the app preview, inspect Diff and Checks, and let the agent create or update the PR.
7. Press Review and choose an independent model (Grok 4.5 via Cursor when authenticated).
8. Merge when checks and review are clean.
9. Archive after merge (automatic archive-on-merge is enabled in shared settings).

## What you do not need to operate

- Git worktrees
- Branch switching
- `npm run agent:start|check|finish|review|cleanup`
- Task YAML authoring for ordinary low-risk work
- Completion or review markdown files
- `HANDOFF.md` as an operating surface (it remains informational only)

## Modes

### Conductor-native (default)

Conductor already provides branch and worktree isolation. Agents must not create nested worktrees. Task contracts remain optional for low-risk bounded work and are strongly recommended or required for Prisma migrations, billing, auth, marketplace publishing, inventory sync, production configuration, destructive refactors, and cross-system architecture changes.

### Manual / non-Conductor (fallback)

The repository CLI and `.agent/` contracts remain available for agents or advanced users outside Conductor. See `docs/operations/multi-agent-development.md`.

## Workspace setup

Shared setup lives in `.conductor/settings.toml` and `scripts/conductor/setup.sh`:

- `npm ci`
- `prisma generate`
- copies approved ignored `.env*` files from the Conductor root checkout when missing
- never runs migrations, deploys, or prints secrets

Conductor assigns each workspace a port via `CONDUCTOR_PORT`. Use **Run → Start Sello**.

## Run menu

- Start Sello
- Scoped validation
- Full validation
- Unit tests
- Build
- Prisma validation
- Repository safety audit

## Safety

Repository invariants, account scoping, marketplace fail-closed behavior, billing enforcement, secret scanning, CI, and protected-path rules remain in force. Conductor is the interface; it does not relax product safety.
