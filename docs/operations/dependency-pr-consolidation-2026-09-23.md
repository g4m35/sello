# Dependency PR consolidation — 2026-09-23

The 17 open dependency PRs were evaluated together against the restored original UI on `develop` (98dacf9). Package versions are resolved in the committed npm lockfile; no application, database schema, marketplace permissions, or automation logic is changed.

| Existing PR | Resolution in this change |
| --- | --- |
| #139, #138 | Next and eslint-config-next 16.3.6; sharp 0.35.4. The duplicate Next request is superseded. |
| #137 | js-yaml 4.3.2 |
| #136, #133 | Vitest and its mocker 4.1.11; duplicate request superseded |
| #135 | Hono 4.13.8 |
| #134 | baseline-browser-mapping 2.11.25 |
| #130 | browserslist 4.29.0 |
| #129 | fast-uri 3.1.8 |
| #127 | nanoid 3.3.19 |
| #123 | Supabase SSR 0.12.7 and client 2.117.0, satisfying SSR's client peer requirement ^2.114.0 |
| #117 | Lucide React 1.47.0 |
| #116, #114 | Tailwind and its PostCSS integration 4.3.3 |
| #115 | BullMQ 5.81.5 |
| #102 | Superseded by Node 24 runtime alignment: @types/node 24.13.6, CI Node 24, engines 24.x. Production Vercel project is configured for Node 24.x; Node 26 types would promise unavailable APIs. |
| #101 | Rejected as incompatible. ESLint remains 9.39.4. Its React plugin does not support ESLint 10; the PR's CI crashed in react/display-name with contextOrFilename.getFilename not a function. No lint rules are disabled. |

Dependabot now sends version updates through `develop`. ESLint 10 updates are temporarily ignored until the React plugin supports them. Node type major updates are ignored until the production/CI runtime is deliberately upgraded; same-major patches remain enabled.

## Security and compatibility evidence

The original npm audit reported 22 affected packages (1 critical, 11 high, 10 moderate). This change resolves 19, including Next/image processing, Vitest mock traversal, Hono, parser and browser-data findings. Existing stale overrides are updated to PostCSS 8.5.25 and @hono/node-server 2.0.10. Narrow overrides update Prisma's MySQL2 to 3.24.4 and @prisma/dev's Valibot to 1.4.2 within their current major versions.

Three high findings remain, all one dependency chain: `prisma` → `@prisma/config` → `deepmerge-ts` 7.1.5. Both full and `--omit=dev` audit report them, because Prisma Client retains Prisma as an optional peer. The vulnerable operation is recursive object merging during Prisma configuration loading. Sello uses a trusted checked-in Prisma config, and Prisma's loader disables remote and extended configuration. This is a limited exposure assessment, not a claim that the advisory is fixed.

Prisma 7.10.0 still pins deepmerge-ts 7.1.5. Deepmerge 8 fixes the advisory but changes Map merging and mutation semantics; forcing that unsupported major version into Prisma merely to silence audit is intentionally avoided. Revisit when Prisma ships a compatible patched dependency. No forced npm audit fix, Prisma downgrade, or Prisma 8 prerelease is applied.

Primary sources checked:

- [Next 16.3.4](https://github.com/vercel/next.js/releases/tag/v16.3.4) and [16.3.6](https://github.com/vercel/next.js/releases/tag/v16.3.6): image and build fixes; matching Next lint package retained.
- [Sharp 0.35.4](https://github.com/lovell/sharp/releases/tag/v0.35.4), [Vitest 4.1.11](https://github.com/vitest-dev/vitest/releases/tag/v4.1.11), [Supabase SSR 0.12.7](https://github.com/supabase/ssr/releases/tag/v0.12.7).
- [ESLint 10 migration](https://eslint.org/docs/latest/use/migrate-to-10.0.0), [React plugin peer support](https://github.com/jsx-eslint/eslint-plugin-react/blob/master/package.json), and [failed PR #101 validation](https://github.com/g4m35/sello/actions/runs/34792279205/job/103818595981).
- [DefinitelyTyped version alignment](https://github.com/DefinitelyTyped/DefinitelyTyped#versioning).
- [MySQL2 3.24.4](https://github.com/sidorares/node-mysql2/releases/tag/v3.24.4), [Valibot 1.4.2](https://github.com/open-circle/valibot/releases/tag/v1.4.2).
- [Deepmerge advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) and [v8 breaking changes](https://github.com/RebeccaStevens/deepmerge-ts/releases/tag/v8.0.0).

Validation uses Node 24.18.0 with the non-secret placeholder environment in `.github/workflows/ci.yml`; no provider actions or database migrations are run. GitHub CI is the final merge gate.

Local result: `npm ci` and `npm ls --depth=0` passed. `npm run validate:full` passed lint, type checking, all 1,918 tests in 257 files, Prisma schema validation, and the Next 16.3.6 production build under Node 24.18.0.
