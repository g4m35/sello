# Pricing comp and provider safety rules

The root `AGENTS.md` remains canonical. Paid-provider code is protected and requires explicit contract scope.

- Never fabricate comps or use AI-generated prices as sold-market evidence.
- Preserve feature access, seller/account quota, global budget, per-user limits, cooldown, provider configuration, identity confidence, and the absolute kill switch.
- Reserve and record paid usage safely before or around provider calls as defined by the existing ledger; do not create retry paths that double-charge.
- Provider failures degrade to typed, seller-safe outcomes without leaking payloads, credentials, stack traces, or environment values.
- Tests must prove each gate and verify that denied paths make no paid call.
