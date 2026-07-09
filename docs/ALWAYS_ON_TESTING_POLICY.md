# Always-on testing policy (owner decision, 2026-07-09)

## Intent
While the app has **no real users**, treat listing/draft/comps surfaces as
**always available for owner testing**. Do not spend time toggling feature
kill-switches on and off for “safety theater.”

## Severity ranking (owner)
| Area | Severity while pre-users | Default posture |
| --- | --- | --- |
| Listing forms / drafts / AI identify | Low | Always on |
| Manual pricing comps (Refresh) | Low–medium (Apify $) | Always on for admin/owner |
| Draft auto-discovery comps | Medium (cost) | Prefer on for owner testing; watch Apify spend |
| Live marketplace publish (eBay/Etsy/StockX) | Medium (creates real listings) | On for owner allowlists so testing is possible; still delist after smoke |
| Billing / Stripe live checkout | High | Don’t complete real charges without intent |

## Rules for agents
1. **Do not** disable listing forms, draft creation, or comps UI “to be safe.”
2. Prefer **admin/owner allowlists** (`ADMIN_EMAILS`, `PAID_COMPS_EMAILS`,
   `LIVE_EBAY_PUBLISH_EMAILS`, etc.) over global kill-switches when gating is
   still required by code.
3. For comps: keep `COMPS_PAID_PROVIDERS_ENABLED=true` and ensure the owner
   email is on `PAID_COMPS_EMAILS`. Admin alone does **not** grant `paidComps`.
4. Cost control while always-on: keep daily Apify budget / per-user call limits
   sane; don’t reintroduce multi-hour cooldowns that block testing.
5. When real users arrive, revisit this policy before opening publish/comps
   broadly.

## Code note
`requireFeatureAccess` allowlists are separate from `ADMIN_EMAILS`. If the
owner can’t Refresh comps, check `PAID_COMPS_EMAILS` and
`COMPS_PAID_PROVIDERS_ENABLED` before assuming a product bug.
