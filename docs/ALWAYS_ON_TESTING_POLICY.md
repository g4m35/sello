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
2. Prefer **admin/owner allowlists** (`ADMIN_EMAILS`) over global kill-switches when
   gating is still required by code.
3. **Admins (`ADMIN_EMAILS` / `ADMIN_USER_IDS`) get unlimited access** on their
   account: all feature entitlements, marketplace connection slots, monthly
   quotas, bulk batch size, and paid-comp budget/cooldown bypass. Free / Pro /
   Kingpin limits still apply to non-admin sellers.
4. For comps globally: keep `COMPS_PAID_PROVIDERS_ENABLED=true`. Admin identity
   alone unlocks paid comps (no separate `PAID_COMPS_EMAILS` required for the
   owner).
5. StockX needs infra flags on: `STOCKX_API_ENABLED`,
   `STOCKX_MARKET_DATA_ENABLED`, and (for listing) `STOCKX_LISTING_ENABLED`,
   plus OAuth credentials. Admin still must complete StockX OAuth once.
6. When real users arrive, revisit this policy before opening publish/comps
   broadly.
