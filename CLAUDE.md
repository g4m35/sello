# Claude / Grok / Cursor Entry Point

`AGENTS.md` is the canonical source of repository instructions. Read it in full, then read the active YAML task contract in `.agent/tasks/active/` and any narrower `AGENTS.md` governing allowed paths.

Work only in the contract's declared Git worktree and branch. Respect `allowed_paths` and `protected_paths`, run the declared scoped validation, and use `npm run agent:finish -- <task-id>` to generate evidence. Never treat `HANDOFF.md` as authoritative, never deploy or merge without contract authorization, and never discard unknown work.
