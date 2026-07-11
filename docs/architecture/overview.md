# Sello architecture overview

This document describes the repository state at `origin/develop` when the multi-agent workflow was established. Code and tests take precedence if the implementation later changes.

## Application framework

Sello is a strict-TypeScript Next.js 16 App Router application with React 19 and Tailwind CSS 4. Route handlers live under `src/app/api/`; authenticated product pages use the `src/app/(app)/` route group. Vitest provides unit and route-level tests, generally colocated with source.

## Authentication and storage

Supabase provides authentication, Postgres, and listing-photo storage. Server routes establish the signed-in user through helpers under `src/lib/supabase/` and `src/lib/auth/`. Authorization is not implied by authentication: seller-owned reads and writes must resolve the active account or an account-derived ownership scope.

## Database and ORM

Prisma 7 models Postgres data in `prisma/schema.prisma`; generated client output lives under `src/generated/prisma/`. Runtime Prisma access uses the Postgres driver adapter in `src/lib/prisma.ts`. Forward migrations and migration-focused tests live under `prisma/migrations/`.

## Account scoping

`Account` is the shared seller workspace. `AccountMember` records active/invited/revoked membership and owner/admin/member roles. New seller-owned state is keyed by `accountId`; legacy creator/audit identifiers such as `sellerId` or `userId` remain where the schema and audit flow require them. `src/lib/billing/account.ts`, `membership.ts`, and `scope.ts` are the canonical helpers for resolving active accounts and building account or inventory-child filters.

## Listings and inventory

`InventoryItem` is the master seller item. It owns photos, AI outputs, listing drafts, comps, marketplace listings, jobs, inventory events, and review tasks. `src/lib/listing/`, `src/lib/view/`, and app/API routes implement draft readiness, editing, views, and lifecycle actions. AI raw and validated output are stored separately after Zod validation.

Durable bulk intake lives under `src/lib/bulk-intake/` and creates those same canonical inventory/listing records; it is not a parallel listing model and performs no marketplace write. Ownership, lifecycle, usage, worker, and sold-reconciliation details are in `docs/architecture/bulk-intake-paid-beta-readiness.md`.

## Marketplace integrations

`src/lib/marketplace/registry.ts` describes each channel's integration mode and capability ceiling. A ceiling is not proof of live readiness. Dedicated eBay, Etsy, and StockX modules live under `src/lib/marketplace/adapters/`; generic/unsupported channels fail closed with typed `NOT_IMPLEMENTED` or assisted-output behavior. Live availability is further reduced by server-side configuration, feature access, account connection, marketplace readiness, and action-specific gates.

## Publishing and delisting

Route handlers call `src/lib/marketplace/publish-handler.ts` and `delist-handler.ts` rather than calling marketplace APIs directly. Marketplace-specific readiness validates credentials/configuration and listing requirements on the server. `MarketplaceListing`, `PublishAttempt`, and `MarketplaceEvent` provide durable status, correlation, audit evidence, and idempotency. The database migration for active/successful attempt keys supplies a concurrency guard that Prisma cannot express directly.

## Inventory synchronization

`src/lib/inventory/mark-sold.ts` is the authoritative sold-state path. It uses optimistic concurrency and a transaction that changes the item, records the sale event, and queues required delist work together. `src/lib/inventory-sync/jobs/worker.ts` claims durable `SyncJob` rows, calls supported adapters, records success/failure evidence, and creates manual review tasks when an operation cannot be safely completed. Duplicate terminal work is idempotent.

## Billing and entitlements

`src/lib/billing/` implements plans, active accounts, memberships/seats, Stripe customers/subscriptions/webhooks, entitlements, connection limits, and usage counters. `src/lib/auth/feature-access.ts` adds server-side alpha/feature access. Admin testing access does not bypass global marketplace/provider kill switches. Billing and capability APIs under `src/app/api/billing/` and `src/app/api/capabilities/` expose sanitized state to the UI.

Metered execution reserves account usage atomically before work and settles/releases the durable reservation afterward. The authoritative fail-closed entitlement order is `src/lib/auth/entitlement-decision.ts`; plan and alpha/beta helpers delegate to it.

## Background jobs

Two durable patterns exist. `src/lib/queues/marketplace-jobs.ts` defines BullMQ/Redis marketplace-job contracts for slow external work. Inventory synchronization uses database-backed `SyncJob` records and the worker under `src/lib/inventory-sync/jobs/`. Both patterns require idempotency, bounded retries, visible failure state, and account scope.

## Provider budget controls

`src/lib/comps/` registers real comp sources and normalizes/deduplicates results. Paid sources are gated by server-side feature access, provider configuration, global budget, per-user daily/monthly quotas, draft cooldown, identity quality, and an absolute kill switch. `ProviderCallLedger` records provider use and cost evidence. No-data and provider-failure paths must remain honest and seller-safe.

## Testing and validation

- Vitest: colocated `*.test.ts` and `*.test.tsx`, plus migration tests.
- ESLint: repository-wide static linting.
- TypeScript: strict no-emit typecheck after Prisma client generation.
- Prisma: schema validation without applying migrations.
- Next.js: production build.
- Agent workflow tests: task parsing, worktree isolation, path/secret/conflict policy, evidence, JSON, review, cleanup, and reconciliation.

Task contracts choose focused validation. Integration uses `npm run validate:full`, and GitHub Actions is the final authority.

## Deployment

The application is hosted on Vercel. No tracked Vercel configuration overrides the repository's Next.js defaults. Deployment is outside normal validation and requires a separately authorized task contract plus explicit owner approval; production migrations and live marketplace/provider actions are not part of a build gate.

## Relevant directories

| Path | Responsibility |
| --- | --- |
| `src/app/` | App Router UI and API route handlers |
| `src/components/` | Shared product UI |
| `src/lib/ai/` | Gemini and structured-output boundaries |
| `src/lib/billing/` | Accounts, plans, Stripe, entitlements, usage |
| `src/lib/comps/` | Comp sources, scoring, provider controls |
| `src/lib/marketplace/` | Capabilities, adapters, publish/delist orchestration |
| `src/lib/inventory/` | Sold state, events, review tasks, delist queueing |
| `src/lib/inventory-sync/` | Durable sync worker |
| `src/lib/queues/` | BullMQ job contracts |
| `prisma/` | Schema and forward migrations |
| `.agent/` | Task contracts and evidence |
