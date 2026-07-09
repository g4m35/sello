# Clerk for auth + billing — research (2026-07-09)

## Question
Replace Supabase Auth + Stripe with Clerk (auth + Clerk Billing) because it is “one product and easier than Stripe.”

## What Clerk offers
- **Auth:** hosted UI, Next.js App Router SDK (`@clerk/nextjs`), middleware, organizations, MFA, etc.
- **Clerk Billing:** B2C/B2B subscriptions managed in the Clerk Dashboard; `auth().has({ plan: '…' })` for gating.
- Payments still go through **Stripe as processor**. Clerk Billing is **not** Stripe Billing — plans/subscriptions do **not** sync into Stripe Billing products.

## Fit for Sello today
| Area | Current | Clerk impact |
| --- | --- | --- |
| Auth | Supabase Auth (cookies via `@supabase/ssr`) wired through middleware + server helpers | Full rewrite of session, middleware, `requireSupabaseUser`, admin allowlist patterns |
| Billing | Stripe + Prisma billing models (`Account`/`Subscription`/usage meters) already in flight | Would discard or dual-run Stripe plan code; Clerk plans won’t map 1:1 to existing metering |
| DB | Prisma on Postgres (Supabase) | Keep DB; only auth identity source changes (`userId` → Clerk user id migration) |
| Marketplaces | eBay/Etsy/StockX OAuth tied to seller user ids | Must remount all seller-scoped rows onto new identity keys |

## Clerk Billing limitations (material)
- No refunds in Clerk (Stripe refunds won’t update Clerk MRR).
- USD only.
- No tax/VAT yet.
- No 3DS / SCA challenge flows (problematic for UK/EU renewals and trials).
- Unsupported countries include Brazil, India, Malaysia, Mexico, Singapore, Thailand.
- Existing Stripe Billing products/plans do **not** import into Clerk.

## Recommendation
**Do not migrate auth/billing to Clerk in this cleanup/deploy cycle.**

Reasons:
1. Supabase Auth + Stripe are already integrated and partially live; Clerk is a multi-week identity + billing migration, not a dep bump.
2. Sello needs usage metering (comps credits, publish caps). That stays custom either way; Clerk only simplifies checkout UI, not metering.
3. Clerk Billing’s SCA/tax/currency gaps are worse for a consumer SaaS that may sell internationally than staying on Stripe Billing directly.
4. “One vendor” is real for auth+checkout UX, but you still operate Stripe + Postgres + Vercel.

### When Clerk *would* make sense
- Greenfield, or before alpha users accumulate.
- Willing to accept USD-only + no 3DS + rebuild identity foreign keys.
- Happy to keep custom metering in Prisma and use Clerk only for plan entitlement checks.

### If pursued later (separate project)
1. Spike: Clerk auth only on a branch; keep Stripe billing.
2. Or: Clerk auth + Clerk Billing for plan gate; migrate Stripe customers carefully.
3. Data migration plan for `User` / seller ids on every marketplace connection.
4. Dual-run period; never cut over without seller login smoke.

## Decision for this session
Document only. Continue cleanup on **Supabase Auth + Stripe**. Revisit Clerk as a dedicated epic after repo hygiene and a green production baseline.
