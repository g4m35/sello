# Sello roadmap: the completed product

Sello is an AI-native resale operating system, not a manual copy/export tool.
The finished product: a seller uploads item photos, AI identifies the item and
produces a complete marketplace-ready listing, the seller reviews only the
values Sello cannot know, and Sello publishes to the selected marketplaces and
keeps them in sync. Manual copy/export remains a fallback for marketplaces
without a safe publish path, never the core flow.

## Product principle

Ask the seller for the fewest possible values. Infer everything that is safe
to infer (item type, marketplace categories, measurement relevance, item
specifics, formatting). Interrupt only for values that are not knowable from
photos and listing context:

- exact garment measurements (never invented from photos)
- hidden flaws
- uncertain size or authenticity
- seller price approval
- shipping/package details where a marketplace requires them
- the final live-publish confirmation

Uncertainty is always explicit: suggestions + confidence, never silent guesses
for publish-critical values.

## The pipeline (target architecture)

1. **Photo intake** — multi-photo upload to Supabase Storage (built).
2. **AI structured extraction** — Gemini, structured JSON only, Zod-validated;
   raw + parsed stored; measurements never invented (built).
3. **Canonical listing model** — `InventoryItem` + `ListingDraft`
   (title/description/bullets/specifics/measurements/flaws/price +
   per-marketplace metadata in `marketplaceDrafts`) (built).
4. **Marketplace requirement inference** — `src/lib/listing/intelligence.ts`:
   item type, department, eBay category resolution with confidence +
   suggestions, measurement profile, recommended seller inputs (built, v1).
5. **Category/aspect/condition/size logic** — deterministic local category map
   for core fashion resale (built); eBay Taxonomy API for long-tail categories
   and **required aspects per category** (next; preflight should surface
   missing required aspects in plain language).
6. **Review only what's uncertain** — editor highlights inferred values,
   suggestions, and the few missing inputs; one-click apply (built, v1).
7. **Preflight/dry run** — exact payload preview, zero outbound calls
   (built for eBay production).
8. **Guarded publishing** — explicit confirmation, hard environment gates;
   production publish unlock is its own deliberate milestone (sandbox built;
   production intentionally locked).
9. **Publish attempts and event logs** — every attempt recorded honestly;
   NOT_IMPLEMENTED is a typed outcome, never a fake success (built).
10. **Marketplace listing IDs/status** — `MarketplaceListing` stores external
    IDs and status per channel (built; production rows arrive with unlock).
11. **Inventory sync** — background worker polls sales/ends listings,
    flags double-sell risk (planned; needs worker host).
12. **Delist on sale** — selling on one channel delists the others after
    confirmation rules (planned).
13. **Failure recovery** — idempotent jobs, retry with backoff, reconnect
    states for expired marketplace tokens (token/reconnect handling built for
    eBay; job retry layer planned with the worker host).
14. **Copy/export fallback** — Depop/Poshmark/Grailed paste-ready text,
    measurement-profile aware (built; stays as fallback only).

## Sequence from here

1. **eBay required aspects in preflight** — fetch per-category required item
   specifics (Taxonomy `getItemAspectsForCategory`), map to friendly prompts,
   feed AI drafts so aspects are prefilled. (The category map above keeps this
   offline-testable; the API is the long-tail path.)
2. **Production publish unlock** — explicit per-listing confirmation UI on top
   of the existing dry run; remove nothing from the gate until then.
3. **Publish-state sync for eBay** — listing status, sold detection, delist.
4. **Worker host** — queues for publish/sync/delist with retries.
5. **Second marketplace adapter** behind the same capability gates.

## Non-negotiables (mirror CLAUDE.md integrity rules)

- Never fake publishing, prices, or comps.
- Never invent measurements or conditions from photos.
- Production publishing stays hard-locked until its dedicated milestone.
- Sellers never need raw category IDs, policy IDs, or marketplace internals;
  those are Sello's job.
