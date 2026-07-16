# Authentication and authorization safety rules

The root `AGENTS.md` remains canonical. Auth and feature-access code is protected by default.

- Authentication establishes identity; server-side authorization still verifies active account membership, role, ownership, feature entitlement, and action-specific readiness.
- Fail closed for missing, stale, ambiguous, or revoked identity/account state.
- Never add email, admin, or client-only fallbacks that bypass the canonical access path.
- Do not log sessions, tokens, magic-link data, cookies, secret values, or raw provider failures.
- Tests must cover anonymous, unrelated-account, revoked-member, role-restricted, admin, and fail-closed configuration paths.
