# Sello invariants

These are mandatory design constraints. A task that cannot preserve them is blocked until the contract and architecture decision are reviewed.

1. All seller-owned data remains account-scoped.
2. Marketplace operations fail closed.
3. Publishing requires server-side readiness validation.
4. Publishing and delisting remain idempotent.
5. Sold-state transitions and required delisting jobs remain transactionally safe.
6. Marketplace credentials, tokens, secrets, and environment values are never logged or committed.
7. Billing and entitlement enforcement occurs server-side.
8. User-facing language says `listing`, never `marketplace-ready draft`.
9. Paid providers remain behind feature, quota, budget, cooldown, and kill-switch controls.
10. Existing marketplace safety behavior is never weakened for UI convenience.
11. Production migrations are forward-safe, auditable, and explicitly authorized.
12. Agents do not deploy unless the active task contract explicitly authorizes deployment.
13. Agents do not silently skip validation because failures appear pre-existing.
14. Agents distinguish introduced failures from verified pre-existing failures.
15. Agents resolve safe ordinary implementation challenges instead of stopping at them.
16. Agents never discard unknown work.
17. Agents never resolve merge conflicts by blindly choosing `ours` or `theirs`.
18. Sensitive backend systems are edited only when the task contract explicitly allows them.
19. Git history, code, tests, task contracts, architecture documentation, validation evidence, review evidence, and CI outrank handoff prose.
20. Every completed task has an evidence-backed completion record.

Additional verified repository invariants:

- AI and external provider output is untrusted; validate it before business use and preserve raw versus validated evidence where the current model requires it.
- A capability ceiling is not current readiness. Missing configuration, connection, entitlement, listing data, or implementation keeps the action disabled.
- Unsupported marketplace actions return typed, honest outcomes and perform no external side effect.
- Marketplace tokens are encrypted at rest and are never sent to the browser.
- The active account, not an email string or client claim, is the authorization boundary for shared seller workspaces.
- Duplicate or conflicting sale signals never overwrite an established sold source silently.
- Paid-provider kill switches are absolute; admin/test access may not bypass them.
- Stripe webhook processing verifies signatures and remains idempotent.
- A local passing gate does not authorize merge or deployment; required GitHub checks and the task contract decide those actions.
