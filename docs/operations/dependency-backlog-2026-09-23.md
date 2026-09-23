# Refreshed dependency backlog — 2026-09-23

This completes the nine dependency requests that arrived after the initial consolidation, on top of the React 19.3 update (develop 6ba4f5a).

| PR | Decision |
| --- | --- |
| #150 | Upgrade Prisma CLI, client, and Postgres adapter together to 7.10.0. Existing config remains supported; no schema change or migration. |
| #151 | Upgrade Vitest to 5.0.1 on Node 24. Its Node >=22.12 requirement is met. New default mock clearing and stricter hoisted mock checks pass the complete suite without disabling checks. |
| #152 | Upgrade Zod to 4.6.5; runtime boundary and schema tests remain intact. |
| #153 | Upgrade yaml to 2.9.1. |
| #154, #155 | Supersede BullMQ 6 and ioredis 6 upgrades by removing both unused dependencies, their unconsumed queue module, its six scaffold tests, and obsolete Redis setup instructions. Active Postgres JobLog/SyncJob workers are retained. |
| #156 | Upgrade pg to 8.23.0 and its types to 8.23.1. No new pipelining behavior is enabled. |
| #157 | Upgrade Stripe SDK to 22.6.2 while explicitly retaining the deployed API contract 2026-06-24.dahlia in both clients. |
| #158 | Upgrade Google GenAI to 2.24.0, the current compatible release satisfying the requested ^2.23.0 range. Models, provider budgets and request logic remain unchanged. |

## Stripe compatibility

The newer SDK types describe API 2026-08-26.dahlia. Changing the runtime API date just to satisfy types would change billing behavior without a billing migration. Both existing clients therefore retain 2026-06-24.dahlia using narrowly placed, explained `@ts-expect-error` annotations on the version property, following Stripe's documented support for older API versions. A server-side unit test constructs the real SDK client without network calls and verifies its configured API version. No payments, product synchronization, prices, or live billing requests are executed.

## Removed infrastructure

Repository-wide reference checks found the BullMQ queue exports were consumed only by their own test. Actual listing preparation and authorized publishing use Postgres `JobLog` queues; inventory synchronization uses `SyncJob`. The obsolete module, dependencies, `REDIS_URL` examples/CI placeholder, and architecture claims are removed. No active worker, cron route, marketplace registry guard, database record, or production environment setting is removed.

## Sources and remaining risk

Reviewed primary sources: [Prisma 7.10](https://github.com/prisma/orm/releases/tag/7.10.0), [Vitest 5 migration](https://vitest.dev/guide/migration/), [Zod 4.6.5](https://github.com/colinhacks/zod/releases/tag/v4.6.5), [yaml 2.9.1](https://github.com/eemeli/yaml/releases/tag/v2.9.1), [pg changelog](https://github.com/brianc/node-postgres/blob/master/CHANGELOG.md), [Stripe 22.6.2](https://github.com/stripe/stripe-node/releases/tag/v22.6.2), [Stripe old API version support](https://github.com/stripe/stripe-node#using-old-api-versions-with-typescript), and [GenAI 2.24](https://github.com/googleapis/js-genai/releases/tag/v2.24.0).

The existing three high npm audit findings remain one chain: Prisma → @prisma/config → deepmerge-ts 7.1.5. Prisma 7.10 still pins this dependency, and deepmerge 8 changes semantics. The earlier audit explanation remains applicable; no unsupported major override or Prisma 8 prerelease is forced. This change does not claim zero vulnerabilities.

Validation uses Node 24.18.0 and non-secret CI placeholders. No live providers or production migrations are part of validation. GitHub CI and independent review remain required before integration.

Local full gate passed: lint (two existing unused test-variable warnings), type checking, 2,028 tests in 262 files, Prisma schema validation, and production build. The test count changes from 2,033 by deleting six unused queue scaffold tests and adding one real Stripe API-version contract test.
