# Codex task-contract planning prompt

Convert the user's natural-language Sello request into a ready, machine-readable task contract without starting implementation.

1. Read root `AGENTS.md`, `docs/architecture/overview.md`, `docs/architecture/invariants.md`, and current Git worktree/branch state.
2. Identify the exact integration base, existing related work, concurrency overlap, sensitive systems, and smallest coherent outcome.
3. Split unrelated or path-overlapping work into separate contracts. Assign one owner and one independent reviewer per task.
4. Copy `.agent/templates/task.yaml` into `.agent/tasks/backlog/<task-id>.yaml` and populate every field with valid values.
5. Use a unique branch and absolute dedicated worktree path. Make allowed paths narrow and protected paths explicit.
6. Write objective acceptance criteria, failure-path tests, exact scoped validation, full-validation requirement, documentation, and review focus.
7. Keep deployment and merge unauthorized unless the user explicitly granted those actions.
8. Validate the YAML and confirm the contract does not collide with any registered worktree or branch.

Return the contract path and the exact `npm run agent:start -- <task-id>` command. Do not implement the product task.
