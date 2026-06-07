# Streetwear Listing Workbench

MVP for an AI-assisted resale cross-listing platform focused on streetwear, sneakers, and hype-fashion sellers.

This first slice intentionally stops at:

1. Supabase email auth.
2. Uploading 1-3 item photos to Supabase Storage.
3. Sending the photos to Gemini with a structured JSON response schema.
4. Validating Gemini output with Zod.
5. Storing the master inventory record, photos, raw AI output, validated AI output, and editable listing draft in Postgres via Prisma.
6. Letting the seller edit and approve the draft.

Marketplace publishing is not implemented or faked. Approval does not enqueue publishing jobs yet.

## Stack

- Next.js App Router, TypeScript, Tailwind
- Supabase Auth, Postgres, and Storage
- Prisma 7 with the Postgres driver adapter
- Gemini via `@google/genai`
- Zod validation
- BullMQ job schemas and queue factories for future publishing and inventory sync work

## Setup

Copy `.env.example` to `.env` and fill in real values:

```bash
cp .env.example .env
```

For the current hosted MVP, Supabase project `xkovtxrdxparbkuysunh` has already been created and the initial Prisma schema plus the `listing-photos` storage bucket have been applied. The server uses the service-role key for uploads; do not expose that key to the browser.

Local `.env.local` already contains the Supabase public URL/key, storage bucket, Gemini model, and Upstash Redis values. Fill in the remaining private values:

```bash
SUPABASE_SERVICE_ROLE_KEY=""
DATABASE_URL=""
DIRECT_URL=""
GEMINI_API_KEY=""
EBAY_ENV="sandbox"
EBAY_CLIENT_ID=""
EBAY_CLIENT_SECRET=""
EBAY_REDIRECT_URI_NAME=""
EBAY_MARKETPLACE_ID="EBAY_US"
EBAY_TOKEN_ENCRYPTION_KEY=""
EBAY_OAUTH_STATE_SECRET=""
EBAY_SANDBOX_PUBLISH_ENABLED="false"
```

Generate Prisma and apply the schema:

```bash
npm run db:generate
npm run db:migrate
```

Use `npm run db:deploy` for a production-style migration apply step from a
controlled environment. Do not run destructive resets against shared Supabase
data. `DATABASE_URL` and `DIRECT_URL` must both come from Supabase Dashboard →
Connect; local migration status remains blocked while either value is a
placeholder or points at the wrong pooler/user.

Start the app:

```bash
npm run dev
```

Open `http://127.0.0.1:3000`.

## eBay Sandbox Setup

Production eBay is not supported yet. Keep `EBAY_ENV=sandbox` and keep
`EBAY_SANDBOX_PUBLISH_ENABLED=false` unless a tester explicitly chooses to run a
guarded sandbox publish. `EBAY_REDIRECT_URI_NAME` is the eBay RuName from the
Sandbox OAuth settings, not a callback URL.

Local browser OAuth needs an HTTPS tunnel. Save the tunnel privacy, accepted,
and declined URLs in the eBay Developer Portal Sandbox OAuth/RuName settings,
then open the app through that same tunnel domain so Supabase cookies are scoped
to the callback domain.

The eBay sandbox publish path uses a deterministic SKU and refuses to publish
again once an eBay offer ID or listing ID is stored for the item. If a network or
API failure happens after an external eBay call but before IDs are persisted,
retry carefully and inspect eBay sandbox state first.

## Quality Checks

```bash
npm test
npm run lint
npm run build
```

## MVP Boundaries

- Gemini responses must be JSON only and must pass `GeminiListingDraftSchema`.
- Live resale comps are not fetched yet. Gemini may suggest comp search queries and a tentative price, but the UI labels pricing as something to verify before publishing.
- eBay is sandbox-only and guarded by server flags. Grailed, Poshmark, and Depop remain `NOT_IMPLEMENTED`.
- `src/lib/queues/marketplace-jobs.ts` only defines validated BullMQ job payloads and queue factories for the next slice.
