# Claude Project Instructions

## Product

We are building an MVP for an AI-powered resale cross-listing SaaS focused on streetwear, sneakers, and hype-fashion sellers.

The app is a Next.js web app, not a mobile-native app.

Core MVP workflow:

1. User uploads 1–3 item photos.
2. Gemini identifies the product.
3. Gemini generates structured marketplace listing drafts.
4. AI outputs are validated with Zod.
5. Outputs and job logs are stored for debugging.
6. User edits and approves the master listing.
7. Marketplace publishing and inventory sync happen later through background jobs.

Do not expand the scope unless explicitly asked.

## Tech Stack

- Next.js
- TypeScript
- Tailwind
- Supabase Auth
- Supabase Postgres
- Supabase Storage
- Prisma
- Gemini API
- Zod
- BullMQ + Redis
- Playwright only where official marketplace APIs are unavailable 

## Database Notes

- DATABASE_URL intentionally uses the Supabase transaction pooler.
- DIRECT_URL had IPv6/DNS connectivity problems on this machine.
- A dedicated role named `resale_app` was intentionally created for runtime/app access.
- Do not switch back to the postgres owner account unless explicitly instructed.
- Preserve the current Prisma/Supabase role strategy.

## Current State

Completed:

- Next.js app with TypeScript and Tailwind
- Supabase Auth
- Supabase Postgres schema through Prisma
- Supabase Storage bucket for listing photos
- Gemini integration using structured JSON output only
- Zod validation for AI outputs
- AI output and draft record storage
- BullMQ/Redis infrastructure for future background jobs
- Local environment variables for Supabase, Gemini, Redis, and database access
- Dedicated Supabase DB role for local/runtime access
- Confirmed local Redis works
- Confirmed Gemini API works locally
- Confirmed Supabase Storage works locally
- Upload → Gemini identification → editable draft workflow
- App-style navigation:
  - Dashboard
  - Workbench
  - Inventory
  - Pricing
  - Channels
  - Jobs
  - Settings
- Marketplace draft previews for eBay, Grailed, Poshmark, and Depop
- Queue/job status UI placeholders
- Editable draft persistence
- Autosave
- Reset to AI draft
- Duplicate draft
- Required-field validation
- Platform-specific warnings

Verification already passed:

- `npm run lint`
- `npm test`
- `npx prisma validate`
- `npm run build`
- Desktop browser QA
- Mobile browser QA

## Hard Rules


- Commits are allowed after successful lint/test/Prisma-validate/build verification.
- Do not push unless explicitly requested.
- Never push `main` without explicit approval.
- Do not deploy unless explicitly requested.
- Auto-deploy (including to Vercel) is forbidden.
- Production deploys must never happen automatically.
- Do not print or expose secrets.
- Do not hardcode secrets.
- Do not fake marketplace publishing success.
- Do not fake pricing comps.
- Do not invent resale prices with Gemini.
- Do not build full marketplace publishing yet.
- Keep publishing draft-only until real adapters/jobs exist.

## Branch And Worktree Rules

- `main` is production-safe only and must be treated as protected.
- `develop` is the active integration branch.
- `feature/*` branches are for isolated feature work.
- AI agents should normally work inside feature branches and their matching worktrees.
- Risky systems, including publishing, inventory sync, adapter work, auth, billing, migrations, and Playwright automation, must use feature branches.
- Never deploy automatically from any branch or worktree.
- Never push `main` without explicit approval.
- Worktrees should be isolated by feature area.
- Never let multiple agents edit the same worktree simultaneously.
- Do not run migrations simultaneously across worktrees.
- Merge flow is `feature/*` -> `develop` -> `main` -> production.

## Engineering Rules

- Use strict TypeScript.
- Use Zod for external data validation.
- Validate all AI outputs.
- Store raw and parsed AI outputs.
- Use Prisma for database access.
- Use background jobs for slow or unreliable operations.
- Use adapter pattern for marketplace integrations.
- Make jobs idempotent.
- Prefer reliable state management over UI polish.
- Add tests for core business logic.
- Run validation before finishing:
  - `npm run lint`
  - `npm test`
  - `npx prisma validate`
  - `npm run build`

## Immediate Next Task

Implement manual price comps v1.

Requirements:

- On the Pricing page and item editor, allow users to manually add comps.
- Fields:
  - source
  - title
  - price
  - shipping
  - sold_date
  - url
  - condition
  - notes
- Store comps in the `PriceComp` table.
- Calculate:
  - low comp
  - average comp
  - high comp
  - quick-sale price
  - recommended list price
- Mark confidence as low, medium, or high based on comp count and similarity.
- Do not use Gemini to invent prices.
- If no comps exist, show “Needs comps.”
- Add tests for pricing calculations.
- Run lint, tests, Prisma validation, and build.
- Commit locally after verification passes. Do not push. Do not deploy.
