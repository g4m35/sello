# Security

## Reporting

If you find a vulnerability, please report it privately via GitHub Security Advisories ("Report a vulnerability" on the repo Security tab) rather than opening a public issue. Do not include real secrets in reports.

## Secrets policy

- Secrets live only in untracked `.env*` files. `.env.example` holds placeholders only.
- Never log, print, echo, or commit API keys, private keys, tokens, or credentials, even in debug output.
- Never commit `.env` files or anything matching `*secret*`, `*key*`, or `*credential*`.
- Examples and tests use clearly fake values, never real production credentials.
- If a secret is committed or leaked, rotate it immediately and scrub it from history.

## Supabase service-role risk

`SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security and has full database access. Treat it as the highest-value secret in the project:

- Server-only. Never sent to the browser, never prefixed `NEXT_PUBLIC_`, never logged.
- Used only for privileged server operations (e.g. storage uploads) that genuinely need it.
- Prefer the anon key + RLS for anything that can be done as the user.

## OAuth token handling (marketplaces)

- Marketplace OAuth access/refresh tokens are encrypted at rest before storage.
- The token encryption key and the OAuth state-signing secret are separate values with distinct purposes.
- OAuth `state` is signed, single-use, short-lived, and bound to the authenticated user; the callback verifies the session user matches the state user before persisting a connection.
- Tokens are never returned to the client or written to logs.

## RLS expectations

- Postgres Row Level Security is the primary tenant-isolation boundary: a user must never read or write another user's items, drafts, comps, or connections.
- Server code must scope every query by the authenticated user id (never trust an id from the request body, query string, or OAuth state).
- Privileged service-role operations must enforce ownership in application code since they bypass RLS.

## GitHub secret scanning and static analysis

- **Dependabot alerts and security updates are enabled** for vulnerable dependencies.
- **GitHub-native secret scanning / push protection** and **CodeQL code scanning** are only free on public repos, or require GitHub Advanced Security on a private repo. While this repo is private without Advanced Security, these are deferred. Gitleaks (CI + local) provides secret scanning in the meantime.
- When the repo becomes public or Advanced Security is enabled, enable native secret scanning + push protection (Settings → Code security) and add a CodeQL workflow / default setup.

## Gitleaks

Secret scanning also runs locally and in CI via Gitleaks.

```bash
# local scan of the working tree, with values redacted
gitleaks detect --source . --redact
```

CI runs Gitleaks on pull requests and on pushes to `main`/`develop`. If a finding appears, treat the affected value as compromised: rotate it, remove it from history, and only report file paths (never the secret value).

## Marketplace publishing risk

- Publishing creates real, externally visible listings and can incur fees or policy violations.
- Real publishing is not implemented; it must never be faked or simulated as successful.
- When built, publishing must be explicit (user-approved), guarded behind flags, sandbox-first, and persisted as typed success/failure outcomes.
- Inventory sync must prevent double-selling and must be idempotent.
