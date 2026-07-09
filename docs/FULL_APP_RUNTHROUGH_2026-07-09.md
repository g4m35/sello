# Full app runthrough — 2026-07-09

Scope: production https://sello.wtf. Owner authenticated smoke completed via
minted session + browser. Listings are low-severity pre-users (see
`docs/ALWAYS_ON_TESTING_POLICY.md`).

## Shipped this session

| Change | Status |
| --- | --- |
| Admin entitlements (PR #72/#73) | Live on main |
| Prod env: `ADMIN_EMAILS`, `APIFY_TOKEN`, `APIFY_EBAY_SOLD_ACTOR`, cooldown 60s, admin override | Set + redeployed |
| Magic-link hash bootstrap (PR #74/#75) | Live (`dpl_AT9AcVq5UQW3agA1kXSNyVZPSKxe`) |

## Working (verified live)

| Area | Result | Notes |
| --- | --- | --- |
| Landing `/`, Pricing `/pricing` | OK | Public 200 |
| Auth gate | OK | Magic-link form when signed out |
| Inventory list | OK | 1 item; sidebar nav; filters |
| Listing detail | OK | Edit form, pricing panel, comps stats |
| Comps refresh | OK | Apify sold comps: 10 fetched/accepted; median $57.50; recommended $63.25 |
| Admin APIs | OK | `/api/admin/feedback`, `provider-usage`, `marketplace-operations` → 200 |
| Admin UI `/admin/feedback` | OK | Reachable when signed in as admin |
| Unauth `/api/listings` | OK | 401 |
| Prod deploy | OK | Aliased to https://sello.wtf |

## Comps notes

- Kill switch `COMPS_PAID_PROVIDERS_ENABLED=true` and Apify source enabled.
- Test SKU `sello-stockx-live-test-*` yields 0 comps (expected). Real style
  `DD1391-100` returns sold comps.
- StockX paid source currently fails (`provider_error`); Apify path is enough.
- Discovery UI may still show a stale "Fresh sold comps are disabled" source
  error string from seller-copy mapping even when a successful run just landed
  comps — cosmetic; pricing panel shows the real evidence.

## Still open / optional

| Item | Notes |
| --- | --- |
| Landing WIP merge | `worktrees/landing-page` vs live simpler landing — decide |
| StockX comps source | Failing in ledger; not blocking Apify |
| eBay live publish | Separate kill-switch `EBAY_PRODUCTION_PUBLISH_ENABLED` |
| Landing plan-name mismatch | Starter vs Free/Pro/Kingpin copy |

## UI/UX notes

**Strengths**
- Brand-first landing; clear inventory shell; comps pricing panel is concrete
- Magic-link auth is simple once hash bootstrap is fixed

**Friction**
- Inventory row click did not navigate (needed direct `/inventory/[id]` URL)
- Landing pricing section names still mismatch `/pricing`
