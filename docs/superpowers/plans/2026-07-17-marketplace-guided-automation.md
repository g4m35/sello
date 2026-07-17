# Marketplace Guided Automation Implementation Plan (Phase A+C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade assisted marketplaces (grailed, poshmark, depop, vinted, new mercari) from a single clipboard blob to a guided publish flow with structured fields, sell-form deep links, and integrated "mark as listed" URL capture that closes the double-sell safety loop; fix registry honesty gaps.

**Architecture:** All changes ride existing seams: `export-formatters.ts` (pure functions), the export route, the marketplace registry, the orphan `POST /api/inventory/listings` route, and the inventory item page. One additive Prisma enum migration (mercari). No new services, no live marketplace calls.

**Tech Stack:** Next.js 16 App Router, strict TS, Zod, Prisma 7, Vitest.

**Worktree:** `~/dev/sello-worktrees/guided-automation`, branch `feature/marketplace-guided-automation` off `main@6b3e5c1`.

## Global Constraints

- Marketplace operations fail closed; never fake capability (AGENTS.md invariants).
- Account scoping on every seller-owned read/write; server-side validation authoritative.
- Never read/print `.env*` values; no secrets in code, tests, or logs.
- Copy style: product term is "listing"; no em dashes in UI copy.
- Tests colocated `*.test.ts(x)`; run focused via `npm test -- --run <file>`.
- Match existing file conventions (see the file being edited before writing).
- Commit per task with a conventional, scoped message; author `g4m35 <jacobantonioboss@gmail.com>`.

---

### Task 1: Add `mercari` as a marketplace (enum ripple)

**Files:**
- Create: `prisma/migrations/20260717000000_add_mercari_marketplace/migration.sql`
- Create: `prisma/migrations/add-mercari-marketplace.test.ts` (mirror `prisma/migrations/` etsy-era enum test if one exists; otherwise mirror the nearest migration test's structure)
- Modify: `prisma/schema.prisma` (enum `Marketplace` L96: add `mercari` after `depop`)
- Modify: `src/lib/ai/listing-draft.ts` `MarketplaceSchema` (add "mercari")
- Modify: every exhaustive `Record<Marketplace, …>`: `src/lib/marketplace/adapter.ts` (`ADAPTERS`: `mercari: createStubAdapter("mercari", "Mercari")`), `src/lib/marketplace/registry.ts` (`MARKETPLACE_REGISTRY.mercari`), `src/lib/inventory/notifications.ts` (`MARKETPLACE_LABELS`)
- Modify: `src/lib/inventory/email-parser.ts` — `MARKETPLACE_DOMAINS` add `["mercari", ["mercari.com", "mail.mercari.com"]]`, `MARKETPLACE_KEYWORDS` add `["mercari", ["mercari"]]`
- Modify: `src/app/api/inventory/listings/route.ts` BodySchema marketplace z.enum (add "mercari")
- Let `npx tsc --noEmit` find any remaining exhaustive maps; update each.

**Interfaces:**
- Produces: `Marketplace` union includes `"mercari"`; registry descriptor `mercari` = `{ integrationMode: "assisted", defaultStatus: "copy_ready", fallbackMode: "copy_ready", capabilities: matrix({ canCreateDraft: true }), uiCopy: "Mercari uses copy-ready drafts; no official listing API exists." , displayName: "Mercari", bestFutureMode: "Assisted export (no official listing API)" }`.

**Migration SQL (complete):**
```sql
-- Add Mercari as a marketplace channel. Additive only: extends the Marketplace
-- enum with 'mercari' so it can appear in selectedMarketplaces,
-- MarketplaceListing, MarketplaceConnection, and MarketplaceImage like the other
-- channels. Mercari is a copy-ready draft channel (no official listing API); the
-- enum value carries no publishing capability on its own.
--
-- ALTER TYPE ... ADD VALUE is safe inside the migration transaction on
-- PostgreSQL 12+ because the new value is not referenced in this same migration.
-- IF NOT EXISTS makes re-running idempotent.
ALTER TYPE "Marketplace" ADD VALUE IF NOT EXISTS 'mercari';
```

- [ ] Write failing registry test additions (`registry.test.ts`): mercari descriptor exists, is publish-queue-eligible=true (assisted), resolveCurrentCapabilities fail-closed.
- [ ] Write failing email-parser test: sale email from `mail.mercari.com` → `marketplaceGuess === "mercari"`.
- [ ] Schema + migration + code ripple until `npm run typecheck` is clean.
- [ ] `npm test -- --run src/lib/marketplace/registry.test.ts src/lib/inventory/email-parser.test.ts prisma/migrations` → PASS.
- [ ] Commit `feat(marketplace): add mercari as assisted channel (additive enum migration)`.

### Task 2: Registry honesty fixes

**Files:**
- Modify: `src/lib/marketplace/registry.ts` — `tiktok_shop.integrationMode: "gated_scaffold"` (keeps capabilities ceiling; now publish-queue-ineligible); `stockx.fallbackMode: null`; `vinted` stays `gated_scaffold` but `fallbackMode: "copy_ready"` (its formatter arrives in Task 3; "assisted_export" is not a mode the export layer implements).
- Test: `src/lib/marketplace/registry.test.ts`

**Interfaces:**
- Produces: `isPublishQueueEligible("tiktok_shop") === false`.

- [ ] Failing tests first: tiktok_shop not queue-eligible; stockx fallbackMode null; vinted fallbackMode copy_ready.
- [ ] Implement; grep for `fallbackMode` consumers (`grep -rn "fallbackMode" src/ --include="*.ts*" | grep -v test`) and update any UI copy branches; run full `npm test` for ripple.
- [ ] Commit `fix(marketplace): honest registry states for tiktok_shop, stockx, vinted`.

### Task 3: Vinted + Mercari export formatters

**Files:**
- Modify: `src/lib/marketplace/export-formatters.ts` — `ExportMarketplaceSchema` = `["depop","poshmark","grailed","etsy","vinted","mercari"]`; add `formatVinted`, `formatMercari`, switch cases.
- Test: `src/lib/marketplace/export-formatters.test.ts`

**Interfaces:**
- Consumes: `ResolvedFields` via existing `resolveFields`.
- Produces: `buildListingExport("vinted"|"mercari", input)` → `{marketplace, title, body, warnings}`.

Formatter shape (follow the file's existing conventions exactly):
```ts
// Vinted: plain description first, factual block, no hashtag spam (Vinted has
// no hashtag culture); measurements and flaws sections as-is.
function formatVinted(input: ListingExportInput, fields: ResolvedFields): string {
  const facts = [
    `Brand: ${input.brand ?? "—"}`,
    `Size: ${input.size?.trim() || "Not specified"}`,
    `Condition: ${fields.conditionText ?? "—"}`,
    fields.priceText ? `Price: ${fields.priceText}` : null,
    input.colorway ? `Color: ${input.colorway}` : null,
  ].filter(Boolean).join("\n");
  return joinSections([
    input.description.trim() || null,
    facts,
    fields.measurementSection,
    fields.flawSection,
  ]);
}

const MERCARI_TITLE_MAX = 80;
const MERCARI_HASHTAG_MAX = 3;
// Mercari: 80-char title cap, up to 3 hashtags at the end of the description.
```
`formatMercari` mirrors `formatDepop` but uses a 3-hashtag cap (generalize `hashtagLine(input, max)` with default `DEPOP_HASHTAG_MAX` so depop behavior is unchanged) and appends nothing Mercari doesn't support; title capped at 80 in `buildListingExport` like poshmark.

- [ ] Failing tests: vinted body has no hashtags; mercari title sliced to 80; mercari hashtags ≤ 3; both include measurements/flaws sections when present; warnings preserved.
- [ ] Implement; `npm test -- --run src/lib/marketplace/export-formatters.test.ts` PASS.
- [ ] Commit `feat(export): vinted + mercari copy-ready formatters`.

### Task 4: Structured fields in export

**Files:**
- Modify: `src/lib/marketplace/export-formatters.ts` — add `ExportField = { key: string; label: string; value: string }`, `ListingExport.fields: ExportField[]`; build in `buildListingExport` from resolved input (title, description, price, brand, size, condition, color, styleCode, tags/hashtags per marketplace, category suggestion). Omit empty values; never fabricate.
- Modify: `src/app/api/listings/[id]/export/route.ts` — include `fields` in the response.
- Modify: `src/lib/api/client.ts` `exportListing` response type: add `fields: { key: string; label: string; value: string }[]`.
- Test: `src/lib/marketplace/export-formatters.test.ts`, `src/app/api/listings/[id]/export/route.test.ts` (follow existing route test file location/pattern).

**Interfaces:**
- Produces: `ListingExport.fields` — stable keys: `title, description, price, brand, size, condition, color, style_code, tags, category`.

- [ ] Failing tests: fields present with exact keys; empty brand → no brand field; price formatted like `fields.priceText`; depop/mercari tags field = hashtag line, etsy/vinted tags field = comma list / absent.
- [ ] Implement; focused tests PASS; `npm run typecheck` clean.
- [ ] Commit `feat(export): structured field-level export payload`.

### Task 5: Guided listing metadata (`sellFormUrl` + URL validation)

**Files:**
- Create: `src/lib/marketplace/guided-listing.ts`
- Test: `src/lib/marketplace/guided-listing.test.ts`

```ts
import type { Marketplace } from "@/lib/ai/listing-draft";

// Guided (assisted) listing metadata for channels the seller lists on manually.
// sellFormUrl opens the marketplace's own listing form in the seller's session;
// listingUrlHosts validates the URL the seller pastes back after listing.
export type GuidedListingMeta = {
  sellFormUrl: string;
  listingUrlHosts: string[];
};

export const GUIDED_LISTING: Partial<Record<Marketplace, GuidedListingMeta>> = {
  grailed: {
    sellFormUrl: "https://www.grailed.com/sell/new",
    listingUrlHosts: ["grailed.com", "www.grailed.com"],
  },
  poshmark: {
    sellFormUrl: "https://poshmark.com/create-listing",
    listingUrlHosts: ["poshmark.com", "www.poshmark.com"],
  },
  depop: {
    sellFormUrl: "https://www.depop.com/products/create",
    listingUrlHosts: ["depop.com", "www.depop.com"],
  },
  vinted: {
    sellFormUrl: "https://www.vinted.com/items/new",
    listingUrlHosts: ["vinted.com", "www.vinted.com"],
  },
  mercari: {
    sellFormUrl: "https://www.mercari.com/sell/",
    listingUrlHosts: ["mercari.com", "www.mercari.com"],
  },
};

export function guidedListingMeta(marketplace: Marketplace): GuidedListingMeta | null;
export function isPlausibleListingUrl(marketplace: Marketplace, url: string): boolean;
// isPlausibleListingUrl: URL parses, https:, host matches listingUrlHosts (or a
// subdomain of a listed apex). Advisory client-side check only; the server
// route stays authoritative.
```

- [ ] Failing tests: meta for all five; null for ebay/etsy/stockx/tiktok_shop; URL check accepts `https://www.grailed.com/listings/123-x`, rejects http:, other hosts, garbage.
- [ ] Implement; focused test PASS.
- [ ] Commit `feat(marketplace): guided listing metadata (sell-form links + URL validation)`.

### Task 6: API client `addMarketplaceListing`

**Files:**
- Modify: `src/lib/api/client.ts` — add near `exportListing`:
```ts
addMarketplaceListing: (
  token: string,
  body: {
    inventoryItemId: string;
    marketplace: Marketplace;
    externalUrl: string;
  },
) =>
  request<{ listing: { id: string; marketplace: Marketplace; status: string; externalUrl: string | null } }>(
    `/api/inventory/listings`,
    token,
    { method: "POST", body: JSON.stringify(body) },
  ),
```
(Match the file's actual `request` helper signature and existing POST examples exactly; confirm the route's response shape by reading `src/app/api/inventory/listings/route.ts` and type it truthfully.)
- Test: only if `client.ts` has existing tests; otherwise covered by route + panel tests.

- [ ] Implement + typecheck clean.
- [ ] Commit `feat(api): client for manual mark-as-listed route`.

### Task 7: Guided listing panel UI

**Files:**
- Create: `src/components/app/guided-listing-panel.tsx` (client component)
- Test: `src/components/app/guided-listing-panel.test.tsx` (follow the repo's existing component-test style; if component tests are route-level only, test the pure helpers and wire-up via the page test conventions)
- Modify: `src/app/(app)/inventory/[id]/page.tsx` — replace the "Copy listing text" card body (L1524-1565) with the panel; keep the existing whole-blob copy button as the panel's first action ("Copy full listing text") so current behavior remains one click.

**Interfaces:**
- Consumes: `api.exportListing` (now returns `fields`), `api.addMarketplaceListing`, `guidedListingMeta`, `isPlausibleListingUrl`, item photos already available on the page (pass photo URLs + names as props).
- Produces: `<GuidedListingPanel item={…} marketplaces={ExportMarketplace[]} photos={{url,label}[]} onListed={() => reload} />`.

Panel behavior per marketplace (accordion or tab per selected export marketplace, match page's existing card/Btn/badge primitives):
1. "Open <name> sell form" external link (`target="_blank" rel="noopener noreferrer"`) when `guidedListingMeta` exists.
2. "Copy full listing text" (existing behavior).
3. Per-field rows: label + truncated value + copy button per `fields`.
4. Photos row: each photo as an "open" link (`target="_blank"`) for drag/save into the marketplace form.
5. "Mark as listed": URL input + save button → client-side `isPlausibleListingUrl` (inline advisory error, still submittable? NO — block submit on invalid, copy: "That does not look like a <name> listing URL.") → `api.addMarketplaceListing` → success state "Tracked. Sello will flag this listing if the item sells elsewhere." and call `onListed` so the page refetches listings.
6. Existing export warnings render unchanged.

- [ ] Failing tests: renders a section per marketplace; copy button writes field value to clipboard (mock `navigator.clipboard`); invalid URL blocks submit with the exact copy above; valid URL calls `api.addMarketplaceListing` with `{inventoryItemId, marketplace, externalUrl}`; success state shown.
- [ ] Implement; focused tests PASS; `npm run lint` 0 errors.
- [ ] Commit `feat(ui): guided listing panel (field copy, sell-form links, mark-as-listed)`.

### Task 8: Docs + research matrix refresh

**Files:**
- Modify: `docs/marketplaces/automation-options.md` — update the top matrix (Depop official Selling API live/partner-gated with sandbox + scopes; Vinted Pro Integrations HMAC/allowlist; Mercari no consumer API; TikTok Shop open registration; guided publish described as the assisted ceiling), add source URLs. Keep the "no scraping" product rule text intact.
- Modify: `HANDOFF.md` — prepend session entry (informational).

- [ ] Write; commit `docs: refresh marketplace automation matrix (2026-07 research)`.

### Task 9: Gate + E2E + browser QA (head session, not delegated)

- [ ] `npm run validate:full` equivalent: `npx prisma validate && npm run lint && npm run typecheck && npm test && npm run build` all green in the worktree.
- [ ] `npm run dev` + `BASE_URL=http://localhost:3940 npx tsx scripts/e2e-smoke.mts` (script self-cleans; confirm it passes and add nothing that mutates other accounts). Confirm export route returns `fields` and `POST /api/inventory/listings` accepts a mercari URL end-to-end.
- [ ] Browser QA of the guided panel (Chrome automation): item page renders panel, copy buttons work, deep links open, mark-as-listed happy + invalid path.
- [ ] Fix anything found; final commit.

---

# Phase B (separate branch `feature/depop-api-foundation` off this branch after merge): Depop official Selling API foundation

Mirror `src/lib/marketplace/adapters/etsy/` 1:1 for Depop (the Etsy adapter is the in-repo reference implementation; read each Etsy file before writing its Depop counterpart):
config (fail-closed env: `DEPOP_API_ENABLED`, `DEPOP_CLIENT_ID`, `DEPOP_CLIENT_SECRET`, `DEPOP_REDIRECT_URI`, `DEPOP_API_BASE_URL`, `DEPOP_SCOPES`, `DEPOP_TOKEN_ENCRYPTION_KEY`, `DEPOP_OAUTH_STATE_SECRET`, allowlists `DEPOP_CONNECT_EMAILS/DEPOP_PUBLISH_EMAILS/DEPOP_DELIST_EMAILS/DEPOP_ORDERS_EMAILS`), errors, token-crypto, oauth (standard OAuth2 code flow per partnerapi.depop.com/api-docs; scopes `products_read products_write orders_read shop_read`), client (Bearer + sanitized error mapping incl. 429 retry-after), capabilities, session, readiness, mapper (SKU-based upsert: Sello inventoryItemId → SKU), publish (create/update product, draft-first), delist (product delete/end via SKU), sync (order read → sale-signal path), routes under `src/app/api/marketplaces/depop/` (connect/callback/disconnect/status/readiness/publish/delist/sync), `feature-access.ts` entitlements (DEPOP_CONNECT/PUBLISH/DELIST/ORDERS), settings `DepopConnectionCard` beside Etsy's, registry flip `depop` → `full_native` + `fallbackMode: "copy_ready"`, docs §Depop, and an owner-ready application email draft (deliverable file `docs/marketplaces/depop-partnership-application.md`).
Same test coverage as Etsy's adapter suite (config fail-closed, client with injected fetch, oauth state/PKCE-equivalent, route 401/403/503, publish/delist handlers, registry).
No live call possible without env credentials; everything fail-closed. Full gate + focused tests.
