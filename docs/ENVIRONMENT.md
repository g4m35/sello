# Environment

All configuration is via environment variables. **Never commit real secrets.** Only `.env.example` is tracked, and it contains placeholders only.

## Files

- **`.env.example`** — tracked template with placeholder values. Copy it to start.
- **`.env`** / **`.env.local`** — your real local values. Both are git-ignored (`.env*` is ignored, with `.env.example` explicitly un-ignored). `.env.local` is the conventional place for machine-specific secrets in Next.js.

```bash
cp .env.example .env
```

## Variables

### Database (Prisma → Supabase Postgres)

- **`DATABASE_URL`** — runtime connection string. This project intentionally uses the Supabase **transaction pooler** (pgbouncer) for app/runtime access.
- **`DIRECT_URL`** — direct (non-pooled) connection used by Prisma for migrations. Note: on some local machines the direct host has had IPv6/DNS issues; see project notes before changing the role strategy.

A dedicated database role is used for runtime/app access rather than the Postgres owner account. Preserve that role strategy.

### Supabase

- **`NEXT_PUBLIC_SUPABASE_URL`** — project URL. Public (sent to the browser).
- **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** — anon/public key. Safe for the browser; relies on Row Level Security to scope data.
- **`SUPABASE_SERVICE_ROLE_KEY`** — **server-only**, full-access key that bypasses RLS. Never expose it to the browser, never prefix it with `NEXT_PUBLIC_`, never log it. Used server-side for storage uploads and privileged operations.
- **`SUPABASE_STORAGE_BUCKET`** — storage bucket name for listing photos (e.g. `listing-photos`).

### Gemini

- **`GEMINI_API_KEY`** — server-only key for the Gemini API. Never exposed to the browser.
- **`GEMINI_MODEL`** — model id (e.g. `gemini-2.5-flash`).

### Redis (BullMQ)

- **`REDIS_URL`** — Redis connection string. Locally this is `redis://localhost:6379`. In hosted environments this is typically an Upstash Redis URL (use the Upstash-provided connection string / TLS `rediss://` URL and credentials). Treat hosted Redis credentials as secrets.

### eBay sandbox (Phase 3 — publishing branch)

These are used by the eBay sandbox publishing work and are **sandbox-only**. They are placeholders here and are not required to run the Phase 1 workbench.

- **`EBAY_ENV`** — must be `sandbox`. Production eBay is disabled.
- **`EBAY_CLIENT_ID`**, **`EBAY_CLIENT_SECRET`** — eBay sandbox app credentials (server-only).
- **`EBAY_REDIRECT_URI_NAME`** — eBay OAuth RuName.
- **`EBAY_MARKETPLACE_ID`** — `EBAY_US`.
- **`EBAY_TOKEN_ENCRYPTION_KEY`** — key used to encrypt stored OAuth tokens at rest.
- **`EBAY_OAUTH_STATE_SECRET`** — separate secret used to sign the OAuth state cookie (kept distinct from the token encryption key).
- **`EBAY_SANDBOX_PUBLISH_ENABLED`** — defaults to `false`. Only the exact string `true` enables guarded sandbox publish calls.

## Rules

- Real secrets live only in untracked `.env*` files.
- Examples and docs use placeholders, never real credentials.
- Anything matching `*secret*`, `*key*`, or `*credential*` must not be committed.
- If a secret is ever committed, rotate it immediately and scrub history.
