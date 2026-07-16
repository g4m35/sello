# Sello

AI-native resale operating system for fashion sellers.

Sello helps sellers turn raw item photos into structured listings, pricing guidance, channel-specific listing content, and publishing workflows. The product is focused on fashion resale first: streetwear, sneakers, vintage, designer, and hype-driven inventory.

## Develop with isolated Git worktrees

Use one native Git worktree and branch per concurrent task. Codex normally owns implementation, review, integration, and sensitive backend work; Cursor or Grok can take bounded tasks in a separately assigned worktree. Repository state, PRs, CI, and review evidence are the shared source of truth.

The optional `agent:*` workflow can create and validate contract-declared worktrees for high-risk work. Details: [`docs/operations/multi-agent-development.md`](docs/operations/multi-agent-development.md).

## Current Status

Sello currently supports the core listing workflow:

- User authentication
- Item photo upload
- AI item identification
- Structured listing draft generation
- Zod-validated AI output
- Editable master listing drafts
- Draft approval flow
- Manual resale comps
- Pricing summary and guidance
- Marketplace connection groundwork
- eBay sandbox integration path

Marketplace integrations are under active development. eBay is the first marketplace target. Production eBay publishing is not enabled by default. Sandbox OAuth, readiness checks, guarded publishing behavior, marketplace connection persistence, and eBay compliance endpoints are part of the current integration work.

Grailed, Poshmark, Depop, and other resale marketplaces remain future adapters.

## Product Goals

Sello is not just a cross-lister. The long-term goal is to make individual fashion resellers operate more like modern ecommerce teams.

Core direction:

- Convert photos into clean product data
- Generate channel-specific listings
- Assist with pricing and comps
- Let sellers choose where inventory should publish
- Automate repetitive listing and sync work
- Track inventory state across marketplaces
- Reduce manual relisting, delisting, and duplicate-entry work
- Build toward a resale operations dashboard

## Features

### Implemented / In Progress

- Magic-link authentication through Supabase
- Upload flow for item photos
- Supabase Storage-backed image handling
- Gemini-powered item recognition and listing generation
- JSON-only AI output validation with Zod
- Prisma-backed inventory and listing draft persistence
- Editable listing draft workflow
- Draft approval state
- Manual resale comp entry
- Pricing summary based on entered comps
- eBay marketplace connection groundwork
- eBay sandbox OAuth/readiness flow
- Guarded eBay sandbox publish path
- Duplicate-publish protection using stored marketplace IDs
- Marketplace account deletion compliance endpoint

### Future

- Production-safe eBay publishing
- Inventory sync and automatic delisting
- Multi-marketplace publishing
- Marketplace-specific field mapping
- Seller analytics
- Bulk listing workflows
- Team/account permissions
- AI-assisted listing optimization
- Social/content workflow expansion

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Auth
- Supabase Postgres
- Supabase Storage
- Supabase SSR cookie-based auth
- Prisma 7 with Postgres driver adapter
- Gemini via `@google/genai`
- Zod runtime validation
- eBay OAuth/API integration groundwork
- AES-256-GCM encrypted marketplace tokens
- BullMQ + Redis job schemas for publishing and inventory sync
- Vitest
- Vercel deployment

## Architecture

Core listing flow:

1. User signs in.
2. User uploads item photos.
3. Photos are stored in Supabase Storage.
4. Gemini analyzes the photos and generates structured listing data.
5. Zod validates the AI response.
6. Prisma stores the inventory item, photos, raw AI output, validated AI output, and editable draft.
7. User edits and approves the master draft.
8. Marketplace-specific adapters handle publishing and sync workflows.

Marketplace integration flow:

1. User connects a marketplace account.
2. OAuth tokens are encrypted before storage.
3. Readiness checks verify required marketplace setup.
4. Publishing remains guarded by environment flags.
5. External marketplace IDs are stored after successful publish attempts.
6. Duplicate publish attempts are blocked when external IDs already exist.

## Local Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the example environment file:

```bash
cp .env.example .env.local
```

Fill in required values:

```bash
NEXT_PUBLIC_SUPABASE_URL=""
NEXT_PUBLIC_SUPABASE_ANON_KEY=""
SUPABASE_SERVICE_ROLE_KEY=""

DATABASE_URL=""
DIRECT_URL=""

GEMINI_API_KEY=""
GEMINI_MODEL=""

REDIS_URL=""

EBAY_ENV="sandbox"
EBAY_CLIENT_ID=""
EBAY_CLIENT_SECRET=""
EBAY_REDIRECT_URI_NAME=""
EBAY_MARKETPLACE_ID="EBAY_US"
EBAY_TOKEN_ENCRYPTION_KEY=""
EBAY_OAUTH_STATE_SECRET=""
EBAY_SANDBOX_PUBLISH_ENABLED="false"

EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN=""
EBAY_MARKETPLACE_DELETION_ENDPOINT=""
```

Notes:

- `DATABASE_URL` is used by the app.
- `DIRECT_URL` is used by Prisma migrations.
- `SUPABASE_SERVICE_ROLE_KEY` is server-only. Never expose it to the browser.
- `EBAY_REDIRECT_URI_NAME` is the eBay RuName, not a callback URL.
- Keep `EBAY_ENV=sandbox` unless production eBay support is intentionally being configured.
- Keep `EBAY_SANDBOX_PUBLISH_ENABLED=false` unless a guarded sandbox publish test is intentional.

### 3. Generate Prisma client

```bash
npm run db:generate
```

### 4. Apply database migrations

For local development:

```bash
npm run db:migrate
```

For production-style migration deploy:

```bash
npm run db:deploy
```

Do not run destructive resets against shared or production Supabase data.

### 5. Start the development server

```bash
npm run dev
```

Open:

```txt
http://127.0.0.1:3000
```

## Agent development workflow

Repository changes use one machine-readable task contract, branch, and isolated worktree per implementation owner. `AGENTS.md` is canonical; `HANDOFF.md` is informational only.

```bash
npm run agent:start -- <task-id-or-file>
npm run agent:status
npm run agent:check -- <task-id-or-file>
npm run agent:finish -- <task-id-or-file>
npm run agent:review -- <task-id-or-file>
npm run agent:cleanup -- <task-id-or-file>
```

Use `npm run validate:scoped` for the fast repository gate and `npm run validate:full` for integration. See `docs/operations/multi-agent-development.md` for task ownership, review, CI, conflict-resolution, and cleanup rules.

## Supabase Notes

Sello uses Supabase for:

- Authentication
- Postgres database
- Listing photo storage

The listing photo storage bucket must exist before upload workflows can work.

Use Supabase Dashboard → Connect to retrieve the correct database connection strings.

Required database connection values:

- `DATABASE_URL`
- `DIRECT_URL`

Required browser-safe Supabase values:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

Required server-only Supabase value:

- `SUPABASE_SERVICE_ROLE_KEY`

Never commit Supabase credentials.

## eBay Integration

### Alpha Live Actions

Live eBay publishing, bulk publishing, live delisting, and paid comps ship behind
independent gates (a global switch plus a per-seller allowlist, both fail-closed).
For the gate matrix, server-side enforcement points, enable/disable steps, the
controlled smoke test, and rollback, see
[`docs/ALPHA_LIVE_ACTIONS.md`](docs/ALPHA_LIVE_ACTIONS.md).

### Supported Mode

Production eBay publishing is not enabled by default.

Default local configuration should stay sandboxed:

```bash
EBAY_ENV="sandbox"
EBAY_SANDBOX_PUBLISH_ENABLED="false"
```

### OAuth / RuName

`EBAY_REDIRECT_URI_NAME` must be the eBay RuName from the eBay Developer Portal. It is not the full callback URL.

Local OAuth testing requires an HTTPS tunnel. The app should be opened through the same tunnel domain that is saved in the eBay Developer Portal, so OAuth callbacks and Supabase cookies are scoped correctly.

### Readiness Checks

The eBay integration should verify required setup before publishing, including:

- Connected marketplace account
- Valid OAuth token state
- Marketplace environment
- Required seller/account configuration
- Required business policy setup where applicable
- Required feature flags

### Sandbox Publish Guardrails

The guarded sandbox publish path should:

- Use deterministic SKUs
- Store external eBay IDs after successful calls
- Block duplicate publish attempts when an offer ID or listing ID is already stored
- Return typed errors instead of pretending unsupported marketplaces work

If a network or API failure happens after an external eBay call but before IDs are persisted, inspect eBay sandbox state before retrying.

### eBay Marketplace Account Deletion Compliance

Production deployments must configure the marketplace account deletion verification values:

```bash
EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN=""
EBAY_MARKETPLACE_DELETION_ENDPOINT="https://sello.wtf/api/marketplaces/ebay/account-deletion"
```

The endpoint must return the expected challenge response for eBay verification.

## Quality Checks

Run before merging or deploying:

```bash
npm test
npm run lint
npm run build
```

Database-related checks:

```bash
npm run db:generate
npm run db:deploy
```

A change should not be merged if tests, lint, build, or Prisma generation fail.

## Deployment

Production runs on Vercel.

Primary production domain:

```txt
https://sello.wtf
```

Before production deploy:

```bash
npm test
npm run lint
npm run build
npm run db:deploy
```

Required production environment variables must be configured in Vercel before deploy.

Do not deploy production with placeholder values for:

- Supabase credentials
- Prisma database URLs
- Gemini API key
- eBay credentials
- eBay token encryption key
- eBay OAuth state secret
- eBay account deletion verification token

## Security

Never expose or commit:

- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`
- `DIRECT_URL`
- `GEMINI_API_KEY`
- `REDIS_URL`
- `EBAY_CLIENT_SECRET`
- `EBAY_TOKEN_ENCRYPTION_KEY`
- `EBAY_OAUTH_STATE_SECRET`
- `EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN`

Marketplace OAuth tokens must remain encrypted at rest.

Server-only credentials must never be sent to client components, browser code, logs, screenshots, or public issue threads.

## Current Boundaries

- Gemini output must be JSON-only and pass the expected listing draft schema.
- AI-generated pricing guidance is assistive, not authoritative.
- Sellers should verify comps before publishing.
- eBay is the first marketplace target and remains guarded by sandbox and feature flags.
- Production marketplace publishing is not enabled by default.
- Grailed, Poshmark, Depop, and other marketplace adapters remain future integrations.
- Queue schemas exist for publishing and inventory sync, but production-grade autonomous sync is not complete yet.

## Roadmap

Near-term:

- Finish production-safe eBay connection flow
- Complete eBay readiness UX
- Enable guarded eBay publishing
- Improve seller-facing listing editor UI
- Add stronger pricing/comps workflow
- Harden deployment and compliance checks

Mid-term:

- Add inventory sync
- Add automatic delisting
- Add marketplace-specific listing requirements
- Add bulk listing workflows
- Add seller dashboard metrics
- Expand marketplace adapter coverage

Long-term:

- Multi-marketplace autonomous publishing
- Cross-platform inventory state management
- AI listing optimization
- Seller operations dashboard
- Resale workflow automation beyond listing creation

## Development Rules

- Do not fake marketplace publishing.
- Unsupported marketplaces should return typed `NOT_IMPLEMENTED` behavior.
- Keep publishing guarded by environment flags.
- Keep marketplace tokens encrypted.
- Do not bypass validation around AI output.
- Do not run destructive database resets against shared Supabase data.
- Do not expose service-role or marketplace secrets to the client.
- Run quality checks before merging.
