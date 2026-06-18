# Landing page, admin pages & feedback system

Built on top of PR #39 (paid-comp budget controls). No deploy; migrations not
applied; no Stripe; no Bulk Intake.

## Admin access (env allowlist)

There is no admin role system, so admins are a **server-side env allowlist**.
Set either (comma-separated):

```
ADMIN_USER_IDS="<supabase-user-uuid>,<another>"
ADMIN_EMAILS="owner@sello.com,ops@sello.com"
```

- Fails **closed**: with neither configured, nobody is an admin.
- The helper `src/lib/auth/admin.ts` (`isAdminUser` / `requireAdminUser`) is the
  single gate, reused by all admin APIs. Non-admins get **404** (admin surface
  hidden). Server-side only; the allowlist is never sent to the client.
- Admin **pages** are client components that render data from admin **APIs**; the
  API is the real boundary (a non-admin sees "Not found.").

> NOTE: `.env.example` could not be edited in-sandbox (`.env*` guarded). Add the
> `ADMIN_*` vars to `.env.example` and the environment manually.

## Routes

| Route | Who | Notes |
|---|---|---|
| `/` | public | Marketing landing page (was a redirect to /dashboard). |
| `/feedback` | authed users | Submit feedback; "Send feedback" is in the app sidebar. |
| `/admin/feedback` | admin | Triage all feedback (status/notes). |
| `/admin/provider-usage` | admin | Cross-user paid-comp spend + recent calls. |
| `POST /api/feedback` | authed | userId from session; strict Zod (rejects client userId). |
| `GET /api/feedback` | authed | Caller's own feedback only. |
| `GET /api/admin/feedback` · `PATCH /api/admin/feedback/[id]` | admin | List + triage. |
| `GET /api/admin/provider-usage` | admin | Cross-user aggregate (seller-scoped `/api/listings/comps/provider-usage` stays per-user). |

## Feedback table

`Feedback` (migration `20260618130000_add_feedback`, additive, RLS on, not
cascaded). Fields: userId, type, severity, marketplace, subject, message, pageUrl,
listingId, draftId, status, adminNotes, timestamps. Input validated with strict
Zod (subject ≤200, message ≤5000). Content is rendered React-escaped (no HTML
injection); no tokens/secrets are stored or returned.

## Pricing/paywall (copy only)

Landing positions full auto-pricing / sold comps as a paid feature ("Paid plans
unlock…", "credit-limited"). **No Stripe, no plan enforcement** — copy/UI only.

## QA steps

1. `/` loads logged-out; says "Automated where supported. Assisted where required.";
   eBay FAQ says no developer account + seller policies; Grailed described as assisted.
2. As an authed user, `/feedback` submits; `/admin/feedback` and `/admin/provider-usage`
   show "Not found." (not admin).
3. Add your id/email to `ADMIN_USER_IDS`/`ADMIN_EMAILS` → admin pages load; you can
   triage feedback and see provider spend.
4. Confirm a normal user cannot read another user's feedback or any provider usage.

## Rollout

1. Apply migrations in order: `20260618120000_add_provider_call_ledger` (PR #39),
   then `20260618130000_add_feedback` (`prisma migrate deploy`). Both additive.
2. Configure `ADMIN_USER_IDS`/`ADMIN_EMAILS` **before** admin pages go live.
3. Keep paid providers disabled/tightly capped (see `COMPS_BUDGET_CONTROLS.md`).
4. No Stripe / Bulk Intake / eBay Path B / scraping in this change.
