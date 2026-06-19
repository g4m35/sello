# Alpha Live Actions — Operator Runbook

Live eBay publishing, bulk publishing, live delisting, and paid comps are shipped
behind independent gates. This runbook covers how the gates compose, where they
are enforced, how to enable/disable per feature, how to smoke test safely, and how
to roll back. No secrets or real allowlist values belong in this file or in git.

## 1. Gate matrix

Each live mutation requires BOTH a global switch AND a per-seller allowlist. The
allowlist is server-only and never sent to the client; the client receives only
booleans from `/api/capabilities`.

| Feature | Global switch | Per-seller allowlist | Preview/read available to all? |
| --- | --- | --- | --- |
| Live eBay publish (single + bulk) | `EBAY_PRODUCTION_PUBLISH_ENABLED=true` (prod) | `LIVE_EBAY_PUBLISH_EMAILS` | Yes — preflight/preview is read-only |
| Live eBay delist | `EBAY_PRODUCTION_PUBLISH_ENABLED=true` (prod) | `EBAY_DELIST_EMAILS` | N/A — no read action |
| Paid comps | `COMPS_PAID_PROVIDERS_ENABLED=true` (+ provider flag) | `PAID_COMPS_EMAILS` | Yes — manual comps always work |
| Admin surfaces | n/a | `ADMIN_EMAILS` / `ADMIN_USER_IDS` | No — 404 for non-admins |

Sandbox publishing uses `EBAY_SANDBOX_PUBLISH_ENABLED` and `EBAY_ENV=sandbox`
instead of the production switch. All switches fail closed when unset.

Bulk publish transport (not a product cap): `BULK_PUBLISH_MAX_ITEMS` (default 1000),
`BULK_PUBLISH_CHUNK_SIZE` (default 20), `BULK_PUBLISH_CONCURRENCY` (default 2,
clamped 1..3). A seller may select their whole eligible inventory; the client
chunks larger selections and shares one `bulkRunId`.

## 2. Server-side enforcement points

UI capability booleans are convenience only. Authorization is enforced server-side:

- `requireFeatureAccess(user, "liveEbayPublish")` — single publish route and bulk
  execute route (`/api/listings/publish`, `/api/listings/publish/bulk`).
- `requireFeatureAccess(user, "ebayDelist")` — delist route (`/api/listings/delist`).
- `runCompFetch(..., { paidProvidersAllowed })` — paid providers only run when the
  global flag is on AND the seller is in `PAID_COMPS_EMAILS`.
- `executePublish` per item — rechecks ownership, ready state, eBay readiness, the
  global publish gate, and the DB duplicate guard, even inside a bulk run.
- `DELETE /api/listings` — refuses items with a live/in-flight marketplace artifact
  (`LISTED`/`LISTING`/`QUEUED`/`DELISTING`) and returns them as `blocked`.
- `requireAdminUser` — admin pages and `/api/admin/*` return 404 to non-admins.

Bulk preflight (`/api/listings/publish/bulk/preflight`) is available to every
authenticated seller and performs no outbound eBay write.

## 3. Enable / disable a single feature

Enable (Production), one feature at a time:

1. Add the seller's email to the relevant allowlist env (`LIVE_EBAY_PUBLISH_EMAILS`,
   `EBAY_DELIST_EMAILS`, or `PAID_COMPS_EMAILS`) in the Vercel Production
   environment. Comma-separated; case-insensitive.
2. For live eBay publish/delist, confirm `EBAY_PRODUCTION_PUBLISH_ENABLED=true`.
3. For paid comps, confirm `COMPS_PAID_PROVIDERS_ENABLED=true` and the specific
   provider flag, and verify the production caps in `.env.example` are applied.
4. Redeploy (env changes require a new deployment to take effect).

Disable a single feature WITHOUT a redeploy of code:

- Remove the seller from the allowlist env and redeploy, OR
- Flip the relevant global switch to `false` (kills the feature for everyone) and
  redeploy. The global publish switch is the fastest blast-radius-wide stop.

The kill switch is absolute and overrides admin override for paid comps.

## 4. Production rollback

Env-var changes and code deploys are both reverted by promoting a previous good
deployment. Look up and roll back with the Vercel CLI (no secrets printed):

```bash
vercel ls <project>                 # list recent deployments, newest first
vercel inspect <deployment-url>     # confirm commit SHA + state of a candidate
vercel rollback <deployment-url>    # promote a previous deployment to production
vercel alias ls                     # confirm the production domain target
```

Prefer rolling back to the last deployment whose commit SHA you recognize as good.
After rollback, re-run the read-only smoke (section 6) against the production
domain to confirm gates are closed.

## 5. Migrations

No new database migrations are introduced by alpha live actions; none are expected.

- Never use `prisma db push`.
- Schema changes route through `develop` as reviewed migrations only.
- If `prisma validate` or `prisma generate` is needed, run them; they do not alter
  the database.

## 6. Controlled smoke test

Run against a single allowlisted alpha seller account. Keep the global publish
switch OFF until the moment of the controlled live test, then turn it off again.

Publish (single):
1. With the seller allowlisted but the global switch OFF, open Publish — confirm
   the live "Create" action is hidden/blocked and preview still renders.
2. Turn the global switch ON, redeploy, retry — confirm the confirmation gate
   appears and a single live listing is created. Verify in eBay Seller Hub.

Bulk publish:
1. Select a small set (2–3 ready items). Confirm preflight shows ready/blocked/
   skipped counts and per-item missing reasons.
2. Non-allowlisted account: confirm "Preview selected" only, no live action.
3. Allowlisted + global switch ON: confirm the explicit "I understand this will
   create live eBay listings." checkbox is required, then run. Confirm each result
   (published/failed/skipped/needs-details) and check Seller Hub for the listings.

Delist:
1. On a live listing, allowlisted + entitled: confirm "End eBay listing" appears,
   run it, and confirm the listing ends in Seller Hub.
2. Not entitled: confirm alpha copy shows instead of the action.

Paid comps:
1. Allowlisted + global paid flag ON: refresh comps on one draft and confirm real
   sold/active comps populate and provider usage is recorded in the admin view.
2. Confirm daily/user caps and cooldowns behave (a second rapid refresh is gated).

Delete safety:
1. Attempt to delete an item with a live listing — confirm it is blocked and the
   UI tells the seller to end the eBay listing first.

## 7. Orphan cleanup

If a publish attempt fails mid-flight and leaves unpublished eBay inventory/offer
artifacts:

1. Open the item, enable advanced diagnostics, run "Check for eBay orphan publish
   artifacts" (read-only scan).
2. If artifacts are found and no live listing is detected, run "Clean up
   unpublished eBay artifacts". The cleanup refuses to run if a live listing is
   detected.

## 8. Log secret scan

After any live test, scan recent runtime logs for accidental secret exposure
before closing out:

```bash
vercel logs <deployment-url> | rg -n "token|secret|Authorization|Bearer|refresh_token" || echo "clean"
```

Expect no token-like values. The admin operations view and publish history are
designed to expose only safe fields (no adapter payloads, tokens, environment
values, raw provider errors, or SKUs).

## 9. Final report checklist

- [ ] Which feature(s) enabled, for which allowlisted account(s).
- [ ] Global switch state before/after the controlled test.
- [ ] Single publish result + Seller Hub confirmation.
- [ ] Bulk publish per-item results + Seller Hub confirmation.
- [ ] Delist result + Seller Hub confirmation.
- [ ] Paid comps populated + usage recorded + caps observed.
- [ ] Delete-safety block observed for a live item.
- [ ] Orphan scan/cleanup outcome (if run).
- [ ] Log secret scan: clean.
- [ ] Final gate state (which switches are OFF again).
- [ ] Rollback deployment URL on standby.
