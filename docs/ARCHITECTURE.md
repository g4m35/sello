# Architecture

## End-to-end flow

```
User
  │  uploads 1–3 photos, signs in
  ▼
Next.js App Router (UI + API route handlers)
  │
  ├─► Supabase Auth ............ authenticates the user (cookie session + bearer)
  │
  ├─► Supabase Storage ......... stores listing photos (server uses service-role key)
  │
  ├─► Gemini (@google/genai) ... structured JSON output only, against a fixed schema
  │
  ├─► Zod validation ........... validates raw AI output before it is trusted/stored
  │
  ├─► Prisma / Postgres ........ persists master item, photos, raw + parsed AI output,
  │                              and the editable listing draft
  │
  ▼
Editable listing draft (user edits, autosaves, approves)
  │
  ▼
Future: marketplace adapters + background jobs (NOT built yet)
```

## Layering rules

- **API routes stay thin.** Route handlers parse input, call into `src/lib`, and shape the response. They do not hold business logic.
- **Business logic lives in `src/lib`.** Pricing math, AI orchestration, marketplace mapping, and lifecycle transitions are testable functions/modules.
- **AI output is validated at the boundary.** Gemini returns JSON; nothing downstream consumes it until Zod accepts it. Raw and parsed outputs are both stored for debugging.
- **Marketplace logic is adapter-shaped.** Each marketplace integration is (or will be) an adapter behind a common interface. Today adapters return typed `NOT_IMPLEMENTED` outcomes.
- **Slow/unreliable work belongs in queues.** BullMQ job payloads are schema-validated; jobs must be idempotent. Workers are not implemented yet.

## Key directories

- `src/app` — App Router pages and API route handlers.
- `src/lib/ai` — Gemini integration and structured-output schemas.
- `src/lib/pricing` — manual comp math (low/avg/high, quick-sale, recommended).
- `src/lib/marketplace` — adapter interfaces and field mapping.
- `src/lib/lifecycle` — item state logic.
- `src/lib/queues` / `src/lib/jobs` — BullMQ schemas and queue factories.
- `src/lib/supabase` — server and browser Supabase clients and auth helpers.
- `prisma/` — schema and migrations (one master item drives all marketplace drafts).

## Data model intent

One **master item** is the source of truth. Marketplace-specific drafts and (future) listings derive from it. Price comps attach to the item. Marketplace connections and publish attempts are persisted as typed records so failures are visible, not silent.

## What is intentionally absent

No real publishing, no inventory sync automation, no marketplace OAuth workers, no Playwright automation, no scraping. These are deferred to later roadmap phases and must not be stubbed in a way that fakes success.
