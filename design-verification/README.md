# Marketplace correction preview — September 22, 2026

Screenshots render the actual modified Sello components and production fonts with synthetic API/session data. They do not represent live accounts or a deployed release. No local browser was launched; browser checks used Browserbase cloud through a temporary fixture tunnel.

- `desktop.png` and exact-width `mobile-390.png`: dark marketplace settings with historical permissions unverified. `marketplaces-light.png` checks light mode.
- `inventory-*`, `upload-*`, `settings-*`: shared shell and heading changes. `connection-dialog-mobile.png`: confirmation controls.
- `marketplace-interactions.json`: keyboard focus/trap/cancel, fixture disconnect success/failure, grant/unknown/missing/expired/setup/error states, reduced motion, and four axe scans.
- `console.json` and `geometry.json`: browser-captured artifacts; geometry uses the unmodified Creative OS capture helper. `validation.txt`: full repository validation.
- `archive-2026-09-09/`: preserved prior design, tests and approval. That approval does not accept this revision.

Independent code review approved. Owner approved the screenshot and release on September 22; see owner-release-approval.md. No new production deployment or live OAuth exercise was performed. Derived digest-bound gate files are regenerated after committing source and remain gitignored. The fixture checks supplement the Next production build; they do not validate live provider health.
