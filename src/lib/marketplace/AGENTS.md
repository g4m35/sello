# Marketplace safety rules

The root `AGENTS.md` remains canonical. Marketplace code is protected by default and requires explicit contract scope.

- Live actions fail closed and require server-side feature access, entitlement/quota checks, environment kill switches, connection state, and marketplace-specific readiness.
- Capability ceilings never imply a live implementation. Unsupported operations return honest typed outcomes and perform no external side effect.
- Publish/delist operations remain idempotent, concurrency-safe, auditable, and seller/account-scoped.
- Never log tokens, provider payloads containing credentials, raw marketplace errors with sensitive data, or environment values.
- Tests must cover disabled, unauthorized, unready, duplicate/racing, upstream failure, retry, and success paths without live marketplace calls.
