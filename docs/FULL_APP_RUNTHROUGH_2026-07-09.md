# Full app runthrough — 2026-07-09

Scope: production https://sello.wtf + code/env research. Authenticated seller
flows (magic-link inbox) were **not** completed in this session — sign-in requires
your email. Findings below separate **verified live** vs **code/env blocked**.

## Policy note (owner)
See `docs/ALWAYS_ON_TESTING_POLICY.md`. Listings are low-severity pre-users;
keep forms/comps available for owner testing. Code change in this session:
**admins get all feature entitlements** (`featureAccessForUser`), so
`ADMIN_EMAILS` alone unlocks comps/publish *allowlists*. Global kill-switches
still apply.

---

## Working (verified live)

| Area | Result | Notes |
| --- | --- | --- |
| Landing `/` | OK | Dark hero, Sello brand, Early access badge, CTAs: Start creating listings / See how it works / Pricing / Sign in |
| Pricing `/pricing` | OK | Free $0 / Pro $20 / Kingpin $119 with quotas; Sign in + plan CTAs |
| Auth gate | OK | `/dashboard`, `/inventory` redirect/show magic-link sign-in (email + Send magic link) |
| Unauth APIs | OK (earlier smoke) | `/api/listings` → 401 |
| Prod deploy | OK | `dpl_9sKm924eAcDc3DkAsDeYAABibhA9` READY on sello.wtf |
| Runtime errors (24h) | Quiet | Vercel runtime logs: no error/fatal/warning in last 24h |

## Not verified (needs your login)

| Area | Why blocked | What to check after magic link |
| --- | --- | --- |
| Dashboard / inventory list | Auth | Sidebar nav, empty states, load speed |
| Create listing `/inventory/new` | Auth | Photo upload → Gemini draft → edit form |
| Pricing comps Refresh | Auth + env | Button visible for admin; Refresh returns comps; Apify spend |
| eBay connect / publish | Auth + env | Settings → marketplaces; readiness; publish (if kill-switch on) |
| Billing settings | Auth | Plan meter, checkout open (don’t complete charge unless intended) |
| Admin pages | Auth | `/admin/feedback`, `/admin/provider-usage`, `/admin/marketplace-operations` |
| StockX / Etsy | Auth + env | Connection cards; listing enabled flags |

## Likely broken / blocked for comps (code + env research)

Even as admin, **Refresh comps still needs production env**:

1. `COMPS_PAID_PROVIDERS_ENABLED=true` (global kill switch — if false, 409 `PAID_COMPS_DISABLED`)
2. At least one source: `COMPS_APIFY_EBAY_SOLD_ENABLED=true` + `APIFY_TOKEN` (+ actor)
3. Item needs meaningful identity (brand/size/style) or paid sources skip
4. Budget not exhausted (`COMPS_APIFY_DAILY_BUDGET_CENTS`, daily/monthly call limits)

**Local `.env.local` is missing all comps/admin allowlist keys** (only Supabase,
DB, eBay sandbox, Gemini, Redis). Local comps/admin testing will fail until those
are copied from Vercel Production.

**Publish still needs** `EBAY_PRODUCTION_PUBLISH_ENABLED=true` (or sandbox flag)
in addition to admin entitlement — that kill-switch is separate on purpose.

## Landing WIP (your work)

Uncommitted rebuild lives in:
`/Users/jheller/Desktop/perc 30/worktrees/landing-page` (`feature/sello-landing-page`)

- Componentized landing (`src/components/landing/*`), contact page, large CSS
- Branch is **behind** current develop/main; production already has a **different**
  simpler landing (PR #71 era)
- **Decision needed:** merge your componentized landing onto current `develop`,
  or keep the live simpler landing and cherry-pick pieces

Stash `wip-before-cleanup-20260709` in clean repo = older channels/UI polish;
partly superseded by shipped work — review before reapplying.

## UI/UX notes (public)

**Strengths**
- Clear brand-first landing; honest marketplace positioning
- Magic-link auth is simple (one field, one CTA)
- Pricing page is scannable with concrete quotas

**Friction / polish**
- Landing pricing section still says “Starter / Seller·Pro” while `/pricing`
  uses Free / Pro / Kingpin — copy mismatch
- Sign-in from landing doesn’t jump to a dedicated `/login` URL (modal/card on
  protected routes) — fine, but “Sign in” click on landing may need a second
  click depending on routing
- No Google/social auth — magic link only (slower for rapid testing)
- `/contact` returned not found in route matrix intent (landing worktree has it;
  production may not)

## Navigation / ease of use (expected once signed in)

From code: sidebar → Dashboard, Inventory, Channels, History, Feedback, Billing,
Settings/Marketplaces, Admin (if admin). Capability-gated buttons hide publish/
comps when entitlements/kill-switches deny — after admin-grant change, UI should
show comps/publish for admins when kill-switches are on.

## Listing / comps performance (expected)

- Manual Refresh: Apify eBay sold ~$0.30–0.36/run historically; cooldown 60s for
  admins; weak-identity items skip paid sources
- Draft auto-discovery: off by default (`COMPS_AUTO_DISCOVERY_ENABLED`) — leave
  off unless you want spend; manual Refresh is enough for testing
- AI draft: depends on Gemini; local has `GEMINI_API_KEY`

## Immediate owner checklist (to make “everything work”)

In **Vercel Production** env (Dashboard → Project → Settings → Environment Variables):

1. Confirm `ADMIN_EMAILS` includes your login email
2. Set `COMPS_PAID_PROVIDERS_ENABLED=true`
3. Set `COMPS_APIFY_EBAY_SOLD_ENABLED=true` + valid `APIFY_TOKEN` / actor
4. Optionally raise `COMPS_USER_DAILY_PROVIDER_CALL_LIMIT` for testing (e.g. 25)
5. For live eBay publish tests: `EBAY_PRODUCTION_PUBLISH_ENABLED=true` only while
   testing; delist after
6. Redeploy after env changes
7. Sign in with magic link → Inventory → open item → Refresh comps

After deploying the admin-entitlement code change from this session, step 1 alone
covers allowlists; steps 2–3 are still required for comps data.

## Cleanup status

| Item | Status |
| --- | --- |
| Desktop orphan archived + symlink | Done |
| Always-on policy doc | Done |
| Admin grants all entitlements | Code done (needs deploy) |
| Landing WIP merge | Pending your decision |
| Authenticated full smoke | Pending your magic-link session |
| Prod comps env confirmation | Pending (Vercel CLI env ls failed here) |
