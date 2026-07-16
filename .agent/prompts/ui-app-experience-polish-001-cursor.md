# Ready-to-paste Cursor/Grok prompt

Implement Sello task `ui-app-experience-polish-001` as the primary owner.

First run `pwd`, `git branch --show-current`, and `git status --short --branch` and confirm you are in `/Users/jheller/dev/resale-crosslister-app-experience` on `feature/app-experience-polish`. Read `AGENTS.md`, `.agent/tasks/active/ui-app-experience-polish-001.yaml`, every `required_reading` entry, and any nested instructions before editing.

Work only inside the declared worktree and only on `allowed_paths`. Never edit a `protected_paths` match. The landing page, `src/app/globals.css`, logo assets, APIs, `src/lib`, Prisma, auth, billing, marketplaces, comps/providers, inventory sync, dependencies, CI, and deployment are outside scope.

Complete the signed-in Sello UI polish across dashboard, inventory, listing detail/editor, channels, and settings. Preserve every existing route, data flow, mutation, gate, readiness result, and error behavior. Keep the current Sello logo. Use honest seller-facing `listing` language. Make desktop/tablet/mobile states coherent and intentional; repair hierarchy, density, responsive overflow, keyboard/focus semantics, contrast, touch targets, loading/empty/error states, and reduced-motion behavior within allowed files. Avoid generic AI-dashboard styling. Use the existing design tokens and component system; do not simulate product capabilities.

Use the repository's required Lazyweb UI-reference/report workflow before making material product-UI judgments, but do not let it expand the contract scope. Capture desktop, tablet, and mobile visual evidence where supported.

Add or update focused tests for changed UI behavior. Run every validation command in the contract. Run `npm run agent:check -- ui-app-experience-polish-001`, commit the implementation, ensure the worktree is clean, then run `npm run agent:finish -- ui-app-experience-polish-001` and commit the generated evidence. Do not merge or deploy.

Return the final commit, exact commands and exit codes, completion-record path, changed files, screenshot/visual-evidence locations, verified pre-existing failures (only with clean-base proof), and the highest-risk review areas for Codex.
