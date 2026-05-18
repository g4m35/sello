<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Agent Operating Rules

## Mission

Build a small, production-minded MVP for an AI resale cross-listing SaaS.

The current goal is not to build the full platform. The goal is to stabilize the core workflow:

Upload photos → Gemini identifies item → Gemini creates structured listing draft → user edits safely → pricing comps support manual pricing → item becomes ready for future publishing.

## Product Scope

In scope now:

- Photo upload
- Gemini product identification
- Structured AI outputs
- Zod validation
- Editable listing drafts
- Draft autosave
- Manual price comps
- Item lifecycle states
- Marketplace previews
- Job queue foundations
- Future adapter structure

Out of scope for now:

- Real marketplace publishing
- Real inventory sync automation
- OAuth for marketplaces
- Playwright marketplace automation
- Scraping
- Mobile-native app
- Paid subscriptions
- Shipping integrations
- AI sourcing intelligence
- Social features
- Advanced analytics

## Non-Negotiables

- Never fake successful marketplace publishing.
- Never fake price comps.
- Never use Gemini to invent market prices.
- Never publish without explicit user approval.
- Never expose secrets.
- Never hardcode environment values.
- Never deploy unless explicitly asked.
- Never let one user access another user’s data.
- Never silently ignore failed validation or failed jobs.

## Architecture Principles

- One master item drives all marketplace drafts/listings.
- Marketplace-specific logic belongs in adapters.
- Pricing logic belongs in testable utility functions.
- AI output must be schema-validated before use.
- Jobs must be idempotent.
- Long-running or unreliable work belongs in queues.
- Errors should be typed and visible enough to debug.
- User-facing UI should prefer clear states over decoration.

## Current Build Order

1. Manual price comps
2. Item lifecycle states
3. Marketplace account placeholders
4. Resale test fixtures
5. eBay adapter planning
6. Inventory sync planning
7. Marketplace publishing later

## Manual Price Comps v1 Rules

A comp is a comparable resale sale or listing entered by the user.

Fields:

- source
- title
- price
- shipping
- sold_date
- url
- condition
- notes

Pricing calculations:

- Total comp price = price + shipping.
- Low comp = lowest valid total.
- Average comp = average valid total.
- High comp = highest valid total.
- Quick-sale price = slightly below average.
- Recommended list price = slightly above average to allow negotiation.

Confidence:

- 0 comps: none / Needs comps
- 1–2 comps: low
- 3–4 comps: medium
- 5+ comps: high

Rules:

- Ignore invalid comps.
- Do not invent missing values.
- Do not use active listings as proof of value unless clearly labeled.
- Do not call Gemini for pricing.
- User can override final price.

## Required Verification

Before reporting completion, run:

```bash
npm run lint
npm test
npx prisma validate
npm run build
```

## Commit / Push / Deploy Policy

- Commits are allowed after successful `npm run lint`, `npm test`, `npx prisma validate`, and `npm run build` verification.
- Pushes are not allowed unless explicitly requested.
- Deploys are not allowed unless explicitly requested.
- Auto-deploy (including auto-deploy to Vercel) is forbidden.
- Never expose or hardcode secrets.
