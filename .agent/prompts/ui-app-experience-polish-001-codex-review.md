# Ready-to-paste Codex review prompt

Independently review and, where the contract authorizes, repair Sello task `ui-app-experience-polish-001`.

Work in `/Users/jheller/dev/resale-crosslister-app-experience` on `feature/app-experience-polish`. Read root `AGENTS.md`, `.agent/tasks/active/ui-app-experience-polish-001.yaml` (or its completed YAML snapshot), `.agent/completed/ui-app-experience-polish-001.md`, all required reading, and applicable nested instructions. Verify the current branch/worktree and inspect the complete `origin/develop...HEAD` diff.

Run `npm run agent:check -- ui-app-experience-polish-001`. Verify every changed path is allowed and no landing, globals.css, logo, backend/API/lib, Prisma, auth, billing, marketplace, comps/provider, inventory-sync, dependency, CI, or deployment path changed. Independently test functional preservation, data-loading/mutation states, responsive desktop/tablet/mobile layout, keyboard navigation, focus visibility, semantic structure, contrast, touch targets, reduced motion, loading/empty/error behavior, honest listing terminology, and Sello-specific visual coherence. Compare the required screenshots/visual evidence with the running app when browser tooling is available.

Record findings as P0-P3 with exact file/line, failure scenario, and required correction. Fix valid findings on this task branch when they stay within allowed paths; add regression tests; rerun every declared validation command and required full validation; update completion evidence. Run `npm run agent:review -- ui-app-experience-polish-001` to generate the diff/review shell, and use `--approve` only after the semantic review is genuinely complete and all required findings/checks pass.

Do not merge or deploy. Return the reviewed commit, findings/resolutions, exact commands and exit codes, review-record path, completion-record path, CI state, and final merge recommendation.
