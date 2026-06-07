# eBay Sandbox Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the `feature/publishing` eBay sandbox hardening pass so the branch is tested, reviewable, and ready to merge.

**Architecture:** Keep the current branch scope narrow: eBay remains sandbox-only, guarded by server flags, and the corrective database work is additive rather than rewriting already-applied historical migrations. Browser auth code should consume Supabase implicit hash sessions once, store them through the existing cookie-backed Supabase browser client, and then remove tokens from the URL.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Prisma 7, Supabase Auth/Postgres, Vitest, ESLint.

---

## File Structure

- Modify: `prisma/migrations/20260606030000_fix_ebay_advisor_findings/migration.sql`
  - Corrects Supabase advisor findings for eBay connection tables without modifying prior applied migration files.
- Modify: `prisma/migrations/ebay-rls.test.ts`
  - Locks the corrective migration to optimized `auth.uid()` policy syntax and the missing foreign-key index.
- Modify: `prisma/schema.prisma`
  - Keeps Prisma schema aligned with the corrective migration by adding `@@index([marketplaceConnectionId])` on `EbaySellerConfig`.
- Modify: `src/lib/supabase/browser.ts`
  - Owns the cookie-backed browser Supabase client and implicit hash-session consumption.
- Modify: `src/app/seller-workbench.tsx`
  - Loads browser auth session for the main seller workflow.
- Modify: `src/app/settings/marketplaces/page.tsx`
  - Loads browser auth session for eBay sandbox settings and readiness calls.
- Optional create: `src/lib/supabase/browser.test.ts`
  - Unit tests for implicit session parsing and URL hash cleanup if manual review finds the helper needs protection.

---

### Task 1: Confirm Branch Baseline

**Files:**
- Inspect: all modified files in `feature/publishing`

- [ ] **Step 1: Confirm only expected files are dirty**

Run:

```bash
cd "/Users/jheller/Desktop/perc 30/worktrees/publishing"
git status --short --branch --untracked-files=all
```

Expected:

```text
## feature/publishing...origin/feature/publishing
 M prisma/migrations/ebay-rls.test.ts
 M prisma/schema.prisma
 M src/app/seller-workbench.tsx
 M src/app/settings/marketplaces/page.tsx
 M src/lib/supabase/browser.ts
?? docs/superpowers/plans/2026-06-06-ebay-sandbox-hardening.md
?? prisma/migrations/20260606030000_fix_ebay_advisor_findings/migration.sql
```

- [ ] **Step 2: Review the full diff**

Run:

```bash
git diff -- prisma/migrations/ebay-rls.test.ts prisma/schema.prisma src/lib/supabase/browser.ts src/app/seller-workbench.tsx src/app/settings/marketplaces/page.tsx
sed -n '1,120p' prisma/migrations/20260606030000_fix_ebay_advisor_findings/migration.sql
```

Expected:
- Migration uses `ALTER POLICY`, not `DROP POLICY`.
- Policy expressions use `"userId" = (select auth.uid())`.
- Migration creates `EbaySellerConfig_marketplaceConnectionId_idx`.
- `consumeSupabaseImplicitSessionFromUrl` removes the hash from the browser URL after `setSession`.

---

### Task 2: Prove the Corrective Migration Locally

**Files:**
- Modify if needed: `prisma/migrations/20260606030000_fix_ebay_advisor_findings/migration.sql`
- Modify if needed: `prisma/migrations/ebay-rls.test.ts`
- Modify if needed: `prisma/schema.prisma`

- [ ] **Step 1: Run the targeted migration test**

Run:

```bash
npm test -- prisma/migrations/ebay-rls.test.ts
```

Expected:

```text
PASS  prisma/migrations/ebay-rls.test.ts
```

- [ ] **Step 2: If the test fails on SQL text, make the migration match this shape**

Use this body in `prisma/migrations/20260606030000_fix_ebay_advisor_findings/migration.sql`:

```sql
-- Resolve Supabase performance advisor findings for eBay connection storage.
-- Historical eBay migrations are already applied in Supabase, so this
-- corrective migration avoids changing their Prisma checksums.

ALTER POLICY "MarketplaceConnection_user_select"
    ON "MarketplaceConnection"
    USING ("userId" = (select auth.uid()));

ALTER POLICY "MarketplaceConnection_user_insert"
    ON "MarketplaceConnection"
    WITH CHECK ("userId" = (select auth.uid()));

ALTER POLICY "MarketplaceConnection_user_update"
    ON "MarketplaceConnection"
    USING ("userId" = (select auth.uid()))
    WITH CHECK ("userId" = (select auth.uid()));

ALTER POLICY "MarketplaceConnection_user_delete"
    ON "MarketplaceConnection"
    USING ("userId" = (select auth.uid()));

ALTER POLICY "EbaySellerConfig_user_select"
    ON "EbaySellerConfig"
    USING ("userId" = (select auth.uid()));

ALTER POLICY "EbaySellerConfig_user_insert"
    ON "EbaySellerConfig"
    WITH CHECK ("userId" = (select auth.uid()));

ALTER POLICY "EbaySellerConfig_user_update"
    ON "EbaySellerConfig"
    USING ("userId" = (select auth.uid()))
    WITH CHECK ("userId" = (select auth.uid()));

ALTER POLICY "EbaySellerConfig_user_delete"
    ON "EbaySellerConfig"
    USING ("userId" = (select auth.uid()));

CREATE INDEX "EbaySellerConfig_marketplaceConnectionId_idx"
    ON "EbaySellerConfig"("marketplaceConnectionId");
```

- [ ] **Step 3: Re-run the targeted migration test**

Run:

```bash
npm test -- prisma/migrations/ebay-rls.test.ts
```

Expected:

```text
PASS  prisma/migrations/ebay-rls.test.ts
```

---

### Task 3: Review Browser Session Consumption

**Files:**
- Modify if needed: `src/lib/supabase/browser.ts`
- Modify if needed: `src/app/seller-workbench.tsx`
- Modify if needed: `src/app/settings/marketplaces/page.tsx`
- Optional create: `src/lib/supabase/browser.test.ts`

- [ ] **Step 1: Inspect the helper for token handling**

Run:

```bash
sed -n '1,120p' src/lib/supabase/browser.ts
```

Expected:
- It imports `Session` and `SupabaseClient` as types.
- It returns `null` when the URL hash is empty.
- It returns `null` when either `access_token` or `refresh_token` is missing.
- It calls `supabase.auth.setSession`.
- It removes the hash with `window.history.replaceState`.

- [ ] **Step 2: If we want test coverage for the helper, add this unit test**

Create `src/lib/supabase/browser.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

import { consumeSupabaseImplicitSessionFromUrl } from "./browser";

describe("consumeSupabaseImplicitSessionFromUrl", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/settings/marketplaces");
  });

  it("returns null when the URL hash does not contain Supabase tokens", async () => {
    window.history.replaceState(null, "", "/settings/marketplaces#type=recovery");
    const supabase = {
      auth: {
        setSession: vi.fn(),
      },
    };

    const session = await consumeSupabaseImplicitSessionFromUrl(supabase as never);

    expect(session).toBeNull();
    expect(supabase.auth.setSession).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#type=recovery");
  });

  it("stores a Supabase implicit session and removes tokens from the URL", async () => {
    window.history.replaceState(
      null,
      "",
      "/settings/marketplaces?tab=ebay#access_token=access-1&refresh_token=refresh-1",
    );
    const expectedSession = { access_token: "access-1" };
    const supabase = {
      auth: {
        setSession: vi.fn().mockResolvedValue({
          data: { session: expectedSession },
          error: null,
        }),
      },
    };

    const session = await consumeSupabaseImplicitSessionFromUrl(supabase as never);

    expect(session).toBe(expectedSession);
    expect(supabase.auth.setSession).toHaveBeenCalledWith({
      access_token: "access-1",
      refresh_token: "refresh-1",
    });
    expect(window.location.pathname).toBe("/settings/marketplaces");
    expect(window.location.search).toBe("?tab=ebay");
    expect(window.location.hash).toBe("");
  });

  it("throws when Supabase rejects the implicit session", async () => {
    window.history.replaceState(
      null,
      "",
      "/#access_token=access-1&refresh_token=refresh-1",
    );
    const supabase = {
      auth: {
        setSession: vi.fn().mockResolvedValue({
          data: { session: null },
          error: new Error("invalid token"),
        }),
      },
    };

    await expect(consumeSupabaseImplicitSessionFromUrl(supabase as never)).rejects.toThrow(
      "invalid token",
    );
  });
});
```

- [ ] **Step 3: Run the optional helper test if added**

Run:

```bash
npm test -- src/lib/supabase/browser.test.ts
```

Expected:

```text
PASS  src/lib/supabase/browser.test.ts
```

---

### Task 4: Run Full Local Quality Gates

**Files:**
- All modified branch files

- [ ] **Step 1: Run the full Vitest suite**

Run:

```bash
npm test
```

Expected:

```text
Test Files  ... passed
Tests       ... passed
```

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected:

```text
No lint errors.
```

- [ ] **Step 3: Run production build**

Run:

```bash
npm run build
```

Expected:
- Prisma generation succeeds.
- Next.js build succeeds.
- No TypeScript errors.

---

### Task 5: Optional Live Supabase Migration Check

**Files:**
- Read: `.env.local`
- Apply: `prisma/migrations/20260606030000_fix_ebay_advisor_findings/migration.sql`

- [ ] **Step 1: Decide whether to apply to the hosted Supabase project now**

Use this decision:
- Apply now if the branch is intended to keep using the existing hosted Supabase project for eBay sandbox QA.
- Do not apply now if we only need local branch verification before PR review.

- [ ] **Step 2: If applying, deploy migrations**

Run:

```bash
npm run db:deploy
```

Expected:
- Prisma reports the new migration as applied.
- No checksum warnings for historical migrations.

- [ ] **Step 3: If deploy fails because credentials are missing, stop and report the exact missing environment variable**

Run:

```bash
node -e 'for (const k of ["DATABASE_URL","DIRECT_URL"]) console.log(`${k}=${process.env[k] ? "set" : "missing"}`)'
```

Expected:
- `DATABASE_URL=set`
- `DIRECT_URL=set`

---

### Task 6: Manual Browser Smoke Test

**Files:**
- Use: running app from `feature/publishing`
- Use: eBay sandbox settings page

- [ ] **Step 1: Start the dev server**

Run:

```bash
npm run dev
```

Expected:
- Prisma generation completes.
- Next.js serves the app on `http://127.0.0.1:3000` or the next available port.

- [ ] **Step 2: Open seller workbench**

Open:

```text
http://127.0.0.1:3000
```

Expected:
- Existing Supabase session loads.
- No visible token hash remains in the URL after auth redirect.
- Seller workbench still loads inventory and draft state.

- [ ] **Step 3: Open eBay sandbox settings**

Open:

```text
http://127.0.0.1:3000/settings/marketplaces
```

Expected:
- Session-dependent readiness request uses the browser session.
- Connect/disconnect buttons render according to readiness state.
- No browser console errors from `consumeSupabaseImplicitSessionFromUrl`.

---

### Task 7: Commit the Finished Branch Work

**Files:**
- Add: `docs/superpowers/plans/2026-06-06-ebay-sandbox-hardening.md`
- Add: `prisma/migrations/20260606030000_fix_ebay_advisor_findings/migration.sql`
- Modify: `prisma/migrations/ebay-rls.test.ts`
- Modify: `prisma/schema.prisma`
- Modify: `src/app/seller-workbench.tsx`
- Modify: `src/app/settings/marketplaces/page.tsx`
- Modify: `src/lib/supabase/browser.ts`
- Optional add: `src/lib/supabase/browser.test.ts`

- [ ] **Step 1: Inspect final status**

Run:

```bash
git status --short --branch --untracked-files=all
```

Expected:
- Only files listed in this task are modified or untracked.

- [ ] **Step 2: Commit**

Run:

```bash
git add docs/superpowers/plans/2026-06-06-ebay-sandbox-hardening.md \
  prisma/migrations/20260606030000_fix_ebay_advisor_findings/migration.sql \
  prisma/migrations/ebay-rls.test.ts \
  prisma/schema.prisma \
  src/app/seller-workbench.tsx \
  src/app/settings/marketplaces/page.tsx \
  src/lib/supabase/browser.ts

git add src/lib/supabase/browser.test.ts 2>/dev/null || true

git commit -m "Harden eBay sandbox auth and RLS"
```

Expected:
- Commit is created on `feature/publishing`.

- [ ] **Step 3: Push**

Run:

```bash
git push origin feature/publishing
```

Expected:
- Remote branch updates successfully.

---

## Self-Review

- Spec coverage: The plan covers the current dirty branch state: Supabase corrective migration, Prisma schema alignment, migration test, browser implicit-session handling, page integrations, quality gates, optional hosted migration deploy, manual browser smoke, and commit/push.
- Placeholder scan: No `TBD`, unresolved `TODO`, or "implement later" placeholders remain. Optional steps are explicitly bounded and include exact commands or code.
- Type consistency: The test uses `consumeSupabaseImplicitSessionFromUrl`, matching the helper name in `src/lib/supabase/browser.ts`; the migration and test both use `EbaySellerConfig_marketplaceConnectionId_idx`; the Prisma model field is `marketplaceConnectionId`.
