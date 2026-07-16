# Codex reviewer/integrator prompt

Review and, where the active contract authorizes it, repair the supplied Sello task.

1. Read root `AGENTS.md`, the task contract at `<TASK_CONTRACT_PATH>`, its completion record at `<COMPLETION_RECORD_PATH>`, required reading, and applicable nested instructions.
2. Verify the worktree/branch and inspect the complete merge-base-to-head diff. Run `npm run agent:check -- <TASK_ID>`.
3. Independently inspect path authorization, functional correctness, account isolation, security, architecture, accessibility, performance, testing, and UX. Treat capabilities and completion claims as untrusted until verified.
4. Run the declared validation independently. Record exact commands, exit codes, and sanitized evidence.
5. Record every finding as P0-P3 with file/line, failure scenario, and required correction in `.agent/reviews/<TASK_ID>.md`.
6. Fix valid findings on the task branch only when authorized, add regression coverage, rerun validation, and refresh completion/review evidence.
7. Fetch the latest base and integrate it carefully when authorized. Resolve conflicts semantically; never choose all `ours` or `theirs`.
8. Run `npm run agent:review -- <TASK_ID>` to generate the diff/report shell. Use `--approve` only after the semantic review is genuinely complete and required findings/checks are clear.
9. Open or update the base-targeted PR when tools and authorization allow. Ensure evidence matches the reviewed commit and required GitHub CI is green.
10. Never merge while required findings/checks fail. Never deploy without explicit deployment authorization and separate owner approval. Do not stop at ordinary repair/integration challenges.
