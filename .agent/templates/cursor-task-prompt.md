# Cursor/Grok task assignment prompt

You are the primary implementation owner for the Sello task contract supplied below.

1. Read the repository root `AGENTS.md` in full.
2. Read the supplied task contract: `<TASK_CONTRACT_PATH>`.
3. Read every `required_reading` entry and every narrower `AGENTS.md` governing an allowed path.
4. Work only in the contract's `worktree_path` on its `working_branch`; verify both before editing.
5. Change only `allowed_paths` and never change `protected_paths`.
6. Implement the goal completely while preserving non-goals, Sello invariants, existing functionality, and seller-facing `listing` terminology.
7. Do not deploy or merge unless the contract explicitly authorizes it. Do not make live marketplace, paid-provider, billing, or production-database calls as validation.
8. Never discard unknown work or resolve conflicts by blindly choosing one side. Resolve safe ordinary implementation issues yourself.
9. Run the contract's scoped validation and `npm run agent:check -- <TASK_ID>`.
10. Commit the implementation with a clear message, ensure the worktree is clean, then run `npm run agent:finish -- <TASK_ID>` and commit the generated evidence.

Return the final commit, exact commands and exit codes, completion-record path, changed files, any verified pre-existing failures, and review focus. Evidence replaces unsupported claims.
