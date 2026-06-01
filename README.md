# Streetwear Listing Workbench

AI-assisted resale cross-listing workbench for streetwear, sneakers, and hype-fashion sellers.

## Status

**Early MVP, pre-launch.** The core workflow (photo → AI draft → validated, editable listing) is working locally. Marketplace publishing is **not** implemented and is never faked. There is no public demo deployment yet.

## Current features

- Supabase email auth.
- Upload 1–3 item photos to Supabase Storage.
- Gemini product identification with a structured JSON response schema.
- Zod validation of all AI output before it is used or stored.
- Persistence of the master item, photos, raw AI output, validated AI output, and editable draft in Postgres via Prisma.
- Editable listing drafts with autosave, reset-to-AI-draft, and duplicate.
- Required-field validation and platform-specific warnings.
- Manual price comps with low/avg/high, quick-sale, and recommended-list calculations and a confidence rating.
- Marketplace draft previews for eBay, Grailed, Poshmark, and Depop.
- BullMQ job schemas and queue factories scaffolded for future background work.

## Not yet implemented

- Real marketplace publishing (eBay, Grailed, Poshmark, Depop).
- Marketplace OAuth and publish/inventory background workers.
- Inventory sync and sold/delist reconciliation.
- Playwright marketplace automation.
- Live/automated resale comps (comps are entered manually).
- Paid plans, shipping integrations, mobile-native app.

## MVP boundaries

- Gemini responses must be JSON only and must pass the listing draft schema. Raw and parsed outputs are both stored.
- AI never invents resale prices. Pricing comes from user-entered comps; the UI labels pricing as something to verify before publishing.
- Marketplace adapters return typed `NOT_IMPLEMENTED` outcomes; nothing is published.
- Publishing success is never simulated. Approval does not enqueue real publishing jobs.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full data flow.

## Roadmap

1. Phase 1 — Listing workbench (current)
2. Phase 2 — Pricing / comps
3. Phase 3 — eBay publishing
4. Phase 4 — Inventory sync
5. Phase 5 — Multi-marketplace publishing

Details and later quality gates (e.g. Lighthouse CI) are in [docs/ROADMAP.md](docs/ROADMAP.md).

## Tech stack

- Next.js App Router, TypeScript, Tailwind
- Supabase Auth, Postgres, and Storage
- Prisma 7 with the Postgres driver adapter
- Gemini via `@google/genai`
- Zod validation
- BullMQ + ioredis job schemas and queue factories

## Local setup

```bash
cp .env.example .env
# fill in real values locally; never commit them
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

Open `http://127.0.0.1:3000`. See [docs/ENVIRONMENT.md](docs/ENVIRONMENT.md) for every variable and what it does.

## Quality checks

```bash
npm run lint
npm test
npx prisma validate
npm run build
```

CI runs the same checks on every pull request and on pushes to `main`/`develop`.

## Security notes

- Secrets live only in untracked `.env*` files; `.env.example` holds placeholders only.
- The Supabase service-role key is server-only and must never reach the browser.
- Marketplace OAuth tokens are encrypted at rest and never logged.
- Secret scanning runs in CI (Gitleaks) and via GitHub secret scanning.

Full policy: [docs/SECURITY.md](docs/SECURITY.md). Report vulnerabilities privately (see that file).

## Development workflow

Branch flow: `feature/*` → `develop` → `main` → production.

- `main` is protected, production-safe state. Never pushed without explicit approval.
- `develop` is the active integration branch.
- Feature work happens in `feature/*` branches and isolated worktrees (see [WORKTREES.md](WORKTREES.md)).
- Open a PR into `develop`; CI and review must pass before merge.
- No automatic deploys. Production deploys are manual and explicit.

## Agent safety note

AI coding agents work in this repo under strict rules: do not fake publishing, do not expose secrets, do not change the schema without a migration, do not skip tests, and do not push without explicit instruction. Full rules: [docs/AGENT_RULES.md](docs/AGENT_RULES.md).

## Demo / preview

No public demo is available yet. A preview link will be added here once a stable deployment exists. _(Placeholder.)_
