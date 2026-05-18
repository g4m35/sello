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

Create a Supabase Storage bucket named by `SUPABASE_STORAGE_BUCKET` (`listing-photos` by default). The server uses the service-role key for uploads; do not expose that key to the browser.

Generate Prisma and apply the schema:

```bash
npm run db:generate
npm run db:migrate
```

Start the app:

```bash
npm run dev
```

Open `http://127.0.0.1:3000`.

## Quality Checks

```bash
npm test
npm run lint
npm run build
```

## MVP Boundaries

- Gemini responses must be JSON only and must pass `GeminiListingDraftSchema`.
- Live resale comps are not fetched yet. Gemini may suggest comp search queries and a tentative price, but the UI labels pricing as something to verify before publishing.
- eBay, Grailed, Poshmark, and Depop publishing workers are not built yet.
- `src/lib/queues/marketplace-jobs.ts` only defines validated BullMQ job payloads and queue factories for the next slice.
