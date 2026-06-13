# PriceComp v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the shipped `PriceComp` comps system in-place to a provider-ready, median-anchored pricing engine (richer columns, per-comp pricing flags, sold-vs-active logic, confidence reasons, edit/delete API, upgraded panel UI, env-gated provider stubs) without renaming the table, breaking production, or inventing prices.

**Architecture:** Additive Prisma migration adds columns + two enums to the existing `PriceComp` table (FK + RLS untouched). The pure pricing module (`src/lib/pricing/comps.ts`) is rewritten to take richer per-comp input, exclude `usedInPricing=false`/`ignoredAsOutlier=true`, compute low/median/average/high anchored on **median**, prefer sold comps when ≥2 exist, and return a numeric confidence score with human-readable reasons. A new `summarizeComps` helper maps DB rows → the pure module so routes stay thin. Existing API routes are extended; a new `[compId]` route adds PATCH/DELETE with the same auth+ownership pattern as the draft route. The comps panel is refactored into pure presentational subcomponents (testable via `renderToStaticMarkup`, the repo's existing component-test approach) plus the interactive container. Five new provider stubs implement the existing `CompSource` interface, env-gated and returning `[]`.

**Tech Stack:** Next.js 16 (App Router, async route params), TypeScript strict, Prisma + Postgres (Supabase pooler), Zod v4, Vitest 4 (node env, `react-dom/server` for component tests — no jsdom/RTL installed), Tailwind v4.

---

## Key facts the executor must respect (verified against the repo)

- **No jsdom / @testing-library is installed.** Component tests use `renderToStaticMarkup` from `react-dom/server` and assert on the HTML string (see `src/components/app/publish-modal.test.tsx`). Interactive behavior (clicks/toggles firing fetch) is **not** testable here — that is why the panel is split into pure presentational components rendered with fixed props.
- **`calculatePricing` has exactly two production callers:** `src/app/api/listings/comps/route.ts` (GET empty case + the local `summarize`) and the type is mirrored in `src/app/comps-panel.tsx`. Both are updated in this plan. Nothing else imports it.
- **Money is stored in cents everywhere** (`priceCents`, `shippingCents`, `recommendedPriceCents`). The spec lists `totalPrice` as "decimal/number"; to match the codebase we store **`totalPriceCents Int?`** (documented deviation — avoids float money, stays consistent). Note this in the final report.
- **`condition` already exists** on `PriceComp` as `ItemCondition @default(unknown)` (an enum, effectively a string). The spec's "condition nullable string if not already present" is satisfied — leave it unchanged.
- **`soldDate` already exists** (`DateTime?`). Leave it.
- **Auth 401 message** from `requireSupabaseUser` is exactly `"Sign in before creating a listing draft."` (asserted by existing tests).
- **Migrations are hand-authored SQL + `prisma generate`** (no live DB needed for the gate — route tests hit 401 before DB, pricing tests are pure). The migration folder must sort **after** `20260613010000_backfill_ebay_quantity`; use `20260613020000_price_comp_v2_fields`.
- **`prisma migrate dev` is unreliable here** (pooler `DATABASE_URL`, IPv6 `DIRECT_URL` issues per CLAUDE.md). Do NOT run it. Hand-author the SQL, then `npx prisma generate` + `npx prisma validate`. The owner applies it to prod via `npm run db:deploy` through develop→main.
- **Commit policy:** project rule is "commit after the verification gate passes," and the task asks for a single message `Upgrade PriceComp pricing comps architecture`. So this plan runs **targeted tests per task as checkpoints (no commit)** and makes **one commit at the end after the full gate**. This intentionally departs from the skill's "frequent commits" default to honor the user's instruction.
- **Branch flow:** `feature/* → develop → main`. Work on a new `feature/price-comp-v2` branch. Do **not** push or merge without owner approval (CLAUDE.md). Committing locally is fine.
- **Do not touch `src/app/seller-workbench.tsx`** — it renders `<CompsPanel accessToken inventoryItemId />` in two places (lines ~1230, ~1433). Props are unchanged, so it keeps working.

---

## File Structure

**Create:**
- `prisma/migrations/20260613020000_price_comp_v2_fields/migration.sql` — additive enums + columns.
- `prisma/migrations/price-comp-v2.test.ts` — asserts the migration is additive/safe (mirrors the existing `ebay-rls.test.ts` location).
- `src/lib/pricing/summarize.ts` — maps `PriceComp` DB rows → `calculatePricing` (shared by both routes).
- `src/app/api/listings/comps/[compId]/route.ts` — PATCH (update) + DELETE one comp.
- `src/app/api/listings/comps/[compId]/route.test.ts` — auth/ownership tests for PATCH/DELETE.
- `src/lib/comps/sources/apify-ebay-sold.ts`, `grailed-sold.ts`, `poshmark-sold.ts`, `depop-active.ts`, `google-lens.ts` — env-gated `CompSource` stubs.
- `src/lib/comps/sources/stubs.test.ts` — asserts stubs are gated + return `[]`.
- `src/app/comps-panel.test.tsx` — renders pure subcomponents via `renderToStaticMarkup`.

**Modify:**
- `prisma/schema.prisma` — add `CompSourceType` + `CompStatus` enums; add columns to `PriceComp`.
- `src/lib/pricing/comps.ts` — richer input type + median/exclusions/sold-preference/confidence.
- `src/lib/pricing/comps.test.ts` — rewritten for median + new behaviors (full replacement).
- `src/lib/pricing/price-comp-input.ts` — extend create schema; add `UpdatePriceCompSchema`, `CompSourceTypeSchema`, `CompStatusSchema`.
- `src/lib/pricing/price-comp-input.test.ts` — add new-field + update-schema cases (full replacement).
- `src/app/api/listings/comps/route.ts` — persist new fields on POST; use `summarizeComps`.
- `src/lib/comps/normalize.ts` — `toPriceCompCreate` sets `status` + `sourceType` for auto comps.
- `src/lib/comps/registry.ts` — register the 5 new stubs.
- `src/app/comps-panel.tsx` — split into `PricingRecommendationCard` + `CompsTable` (pure, exported) + container with platform/status selectors, edit, delete, toggles, median display, counts, reasons.

---

## Task 0: Branch + sanity baseline

**Files:** none (setup only).

- [ ] **Step 1: Create the feature branch off develop**

```bash
cd "/Users/jheller/Desktop/perc 30/resale-crosslister"
git fetch origin
git checkout -b feature/price-comp-v2 origin/develop
```

If `origin/develop` is unavailable, branch off local `develop`: `git checkout -b feature/price-comp-v2 develop`.

- [ ] **Step 2: Install + generate client (baseline)**

```bash
npm install
npx prisma generate
```

- [ ] **Step 3: Confirm the baseline gate is green BEFORE changes**

Run: `npm test`
Expected: all suites pass (this is the known-good baseline; ~319 tests per HANDOFF). If anything fails here, stop — it is a pre-existing issue, not ours.

---

## Task 1: Prisma schema + additive migration

**Files:**
- Modify: `prisma/schema.prisma` (enums after the existing `ItemCondition` enum block near line 31–39; `PriceComp` model at lines 161–177)
- Create: `prisma/migrations/20260613020000_price_comp_v2_fields/migration.sql`
- Test: `prisma/migrations/price-comp-v2.test.ts`

- [ ] **Step 1: Write the failing migration-safety test**

Create `prisma/migrations/price-comp-v2.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const migrationsDir = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(migrationsDir, "20260613020000_price_comp_v2_fields", "migration.sql"),
  "utf8",
);

describe("price_comp_v2 migration", () => {
  it("creates the two new enums", () => {
    expect(sql).toContain(`CREATE TYPE "CompSourceType"`);
    expect(sql).toContain(`CREATE TYPE "CompStatus"`);
  });

  it("adds every new PriceComp column", () => {
    for (const col of [
      "sourceType",
      "platform",
      "status",
      "brand",
      "size",
      "currency",
      "totalPriceCents",
      "imageUrl",
      "matchScore",
      "usedInPricing",
      "ignoredAsOutlier",
      "rawJson",
    ]) {
      expect(sql, `missing column ${col}`).toContain(`"${col}"`);
    }
  });

  it("is additive and non-destructive", () => {
    expect(sql).not.toMatch(/DROP\s+TABLE/i);
    expect(sql).not.toMatch(/DROP\s+COLUMN/i);
    expect(sql).not.toMatch(/RENAME/i);
    // Keeps the table named PriceComp.
    expect(sql).toContain(`ALTER TABLE "PriceComp"`);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run prisma/migrations/price-comp-v2.test.ts`
Expected: FAIL — `ENOENT` (migration.sql does not exist yet).

- [ ] **Step 3: Author the migration SQL**

Create `prisma/migrations/20260613020000_price_comp_v2_fields/migration.sql`:

```sql
-- PriceComp v2: provider-ready columns. Additive only. FK + RLS unchanged.
-- Existing rows backfill via column defaults (status=unknown, sourceType=manual,
-- usedInPricing=true, ignoredAsOutlier=false, currency=USD), so old manual comps
-- keep working unchanged.

-- CreateEnum
CREATE TYPE "CompSourceType" AS ENUM ('manual', 'api', 'scraper', 'visual_search');

-- CreateEnum
CREATE TYPE "CompStatus" AS ENUM ('sold', 'active', 'unknown');

-- AlterTable
ALTER TABLE "PriceComp"
  ADD COLUMN "sourceType" "CompSourceType" NOT NULL DEFAULT 'manual',
  ADD COLUMN "platform" TEXT,
  ADD COLUMN "status" "CompStatus" NOT NULL DEFAULT 'unknown',
  ADD COLUMN "brand" TEXT,
  ADD COLUMN "size" TEXT,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN "totalPriceCents" INTEGER,
  ADD COLUMN "imageUrl" TEXT,
  ADD COLUMN "matchScore" DOUBLE PRECISION,
  ADD COLUMN "usedInPricing" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "ignoredAsOutlier" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rawJson" JSONB;
```

- [ ] **Step 4: Update `prisma/schema.prisma`**

Add the two enums immediately after the `ItemCondition` enum (after its closing `}` near line 39):

```prisma
enum CompSourceType {
  manual
  api
  scraper
  visual_search
}

enum CompStatus {
  sold
  active
  unknown
}
```

Replace the `PriceComp` model (lines 161–177) with the extended version (keeps id/FK/index/RLS-relevant shape, adds the new fields):

```prisma
model PriceComp {
  id               String         @id @default(uuid()) @db.Uuid
  inventoryItemId  String         @db.Uuid
  inventoryItem    InventoryItem  @relation(fields: [inventoryItemId], references: [id], onDelete: Cascade)
  source           String
  sourceType       CompSourceType @default(manual)
  platform         String?
  status           CompStatus     @default(unknown)
  title            String
  brand            String?
  size             String?
  priceCents       Int
  shippingCents    Int            @default(0)
  totalPriceCents  Int?
  currency         String         @default("USD")
  soldDate         DateTime?
  url              String?
  imageUrl         String?
  condition        ItemCondition  @default(unknown)
  matchScore       Float?
  usedInPricing    Boolean        @default(true)
  ignoredAsOutlier Boolean        @default(false)
  rawJson          Json?
  notes            String?
  createdAt        DateTime       @default(now())
  updatedAt        DateTime       @updatedAt

  @@index([inventoryItemId, createdAt])
}
```

- [ ] **Step 5: Regenerate client + validate**

```bash
npx prisma generate
npx prisma validate
```
Expected: `The schema at prisma/schema.prisma is valid 🚀` and a regenerated client. Do NOT run `prisma migrate dev`.

- [ ] **Step 6: Run the migration test to verify it passes**

Run: `npx vitest run prisma/migrations/price-comp-v2.test.ts`
Expected: PASS (3 tests).

---

## Task 2: Pricing module — median, exclusions, sold-preference, confidence reasons

**Files:**
- Modify: `src/lib/pricing/comps.ts` (full rewrite)
- Test: `src/lib/pricing/comps.test.ts` (full rewrite)

- [ ] **Step 1: Write the new failing tests**

Replace the entire contents of `src/lib/pricing/comps.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { calculatePricing, type PricingComp } from "./comps";

function comp(overrides: Partial<PricingComp> = {}): PricingComp {
  return { priceCents: 10000, shippingCents: 0, ...overrides };
}

describe("calculatePricing", () => {
  it("reports needs_comps when there are no comps", () => {
    const s = calculatePricing([]);
    expect(s.status).toBe("needs_comps");
    expect(s.confidence).toBe("none");
    expect(s.confidenceScore).toBe(0);
    expect(s.confidenceReasons.length).toBeGreaterThan(0);
    expect(s.validComps).toBe(0);
    expect(s.compCount).toBe(0);
    expect(s.medianCents).toBeNull();
    expect(s.averageCents).toBeNull();
    expect(s.quickSaleCents).toBeNull();
    expect(s.recommendedListCents).toBeNull();
  });

  it("adds shipping to price for the comp total", () => {
    const s = calculatePricing([comp({ priceCents: 10000, shippingCents: 1500 })]);
    expect(s.status).toBe("ready");
    expect(s.lowCents).toBe(11500);
    expect(s.medianCents).toBe(11500);
    expect(s.averageCents).toBe(11500);
    expect(s.highCents).toBe(11500);
  });

  it("uses totalPriceCents when present instead of price + shipping", () => {
    const s = calculatePricing([
      comp({ priceCents: 10000, shippingCents: 1500, totalPriceCents: 9000 }),
    ]);
    expect(s.medianCents).toBe(9000);
  });

  it("computes low, median, average, and high across valid comps", () => {
    const s = calculatePricing([
      comp({ priceCents: 10000 }),
      comp({ priceCents: 20000 }),
      comp({ priceCents: 30000 }),
    ]);
    expect(s.lowCents).toBe(10000);
    expect(s.medianCents).toBe(20000);
    expect(s.averageCents).toBe(20000);
    expect(s.highCents).toBe(30000);
  });

  it("anchors quick-sale and recommended on the MEDIAN, not the average", () => {
    // median 10000, average 20000 — proves median is the anchor.
    const s = calculatePricing([
      comp({ priceCents: 10000 }),
      comp({ priceCents: 10000 }),
      comp({ priceCents: 40000 }),
    ]);
    expect(s.medianCents).toBe(10000);
    expect(s.averageCents).toBe(20000);
    expect(s.quickSaleCents).toBe(9000); // 10000 * 0.9
    expect(s.recommendedListCents).toBe(11000); // 10000 * 1.1
  });

  it("excludes comps flagged usedInPricing=false", () => {
    const s = calculatePricing([
      comp({ priceCents: 10000, usedInPricing: true }),
      comp({ priceCents: 99999, usedInPricing: false }),
    ]);
    expect(s.totalComps).toBe(2);
    expect(s.validComps).toBe(1);
    expect(s.medianCents).toBe(10000);
  });

  it("excludes comps flagged ignoredAsOutlier=true", () => {
    const s = calculatePricing([
      comp({ priceCents: 10000 }),
      comp({ priceCents: 99999, ignoredAsOutlier: true }),
    ]);
    expect(s.validComps).toBe(1);
    expect(s.medianCents).toBe(10000);
  });

  it("ignores comps with non-positive price or invalid shipping", () => {
    const s = calculatePricing([
      comp({ priceCents: 10000, shippingCents: 0 }),
      comp({ priceCents: 0 }),
      comp({ priceCents: -500 }),
      comp({ priceCents: 12000, shippingCents: -100 }),
      comp({ priceCents: Number.NaN }),
    ]);
    expect(s.totalComps).toBe(5);
    expect(s.validComps).toBe(1);
    expect(s.medianCents).toBe(10000);
  });

  it("prefers sold comps over active comps when at least 2 sold comps exist", () => {
    const s = calculatePricing([
      comp({ priceCents: 10000, status: "sold" }),
      comp({ priceCents: 12000, status: "sold" }),
      comp({ priceCents: 14000, status: "sold" }),
      comp({ priceCents: 50000, status: "active" }),
      comp({ priceCents: 50000, status: "active" }),
    ]);
    expect(s.soldCompCount).toBe(3);
    expect(s.activeCompCount).toBe(2);
    // Active 50000s are excluded from the anchor because sold comps dominate.
    expect(s.medianCents).toBe(12000);
    expect(s.highCents).toBe(14000);
    expect(s.confidenceReasons.some((r) => r.includes("sold"))).toBe(true);
  });

  it("falls back to all eligible comps when fewer than 2 sold comps exist", () => {
    const s = calculatePricing([
      comp({ priceCents: 10000, status: "sold" }),
      comp({ priceCents: 20000, status: "active" }),
      comp({ priceCents: 30000, status: "active" }),
    ]);
    expect(s.medianCents).toBe(20000); // all three used
  });

  it("scales confidence up for a large, recent, consistent sold sample", () => {
    const today = new Date();
    const s = calculatePricing(
      Array.from({ length: 5 }, (_, i) =>
        comp({
          priceCents: 20000 + i * 200,
          status: "sold",
          soldDate: today,
          brand: "Nike",
          size: "10",
          condition: "used_good",
          matchScore: 0.9,
        }),
      ),
    );
    expect(s.confidence).toBe("high");
    expect(s.confidenceScore).toBeGreaterThanOrEqual(0.7);
    expect(s.confidenceReasons.some((r) => r.includes("sold"))).toBe(true);
  });

  it("returns low confidence for a single active asking-price comp", () => {
    const s = calculatePricing([comp({ priceCents: 10000, status: "active" })]);
    expect(s.confidence).toBe("low");
    expect(s.confidenceReasons.some((r) => r.toLowerCase().includes("active"))).toBe(true);
  });

  it("penalizes a wide price spread in the confidence reasons", () => {
    const s = calculatePricing([
      comp({ priceCents: 5000, status: "active" }),
      comp({ priceCents: 8000, status: "active" }),
      comp({ priceCents: 60000, status: "active" }),
    ]);
    expect(s.confidenceReasons.some((r) => r.toLowerCase().includes("spread"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/pricing/comps.test.ts`
Expected: FAIL (e.g. `medianCents` / `compCount` / `PricingComp` not exported).

- [ ] **Step 3: Rewrite `src/lib/pricing/comps.ts`**

Replace the entire file:

```ts
export type CompStatus = "sold" | "active" | "unknown";

// Richer per-comp input. Every field beyond price/shipping is optional so legacy
// callers passing `{ priceCents, shippingCents }` keep working unchanged.
export type PricingComp = {
  priceCents: number;
  shippingCents: number;
  totalPriceCents?: number | null;
  status?: CompStatus;
  usedInPricing?: boolean;
  ignoredAsOutlier?: boolean;
  matchScore?: number | null;
  soldDate?: Date | string | null;
  brand?: string | null;
  size?: string | null;
  condition?: string | null;
};

export type PricingConfidence = "none" | "low" | "medium" | "high";

export type PricingSummary = {
  status: "needs_comps" | "ready";
  totalComps: number;
  validComps: number;
  compCount: number;
  soldCompCount: number;
  activeCompCount: number;
  lowCents: number | null;
  medianCents: number | null;
  averageCents: number | null;
  highCents: number | null;
  quickSaleCents: number | null;
  recommendedListCents: number | null;
  confidence: PricingConfidence;
  confidenceScore: number;
  confidenceReasons: string[];
};

// Median anchors both derived prices: quick sale slightly below, list slightly
// above, to leave negotiation room.
export const QUICK_SALE_FACTOR = 0.9;
export const LIST_PREMIUM_FACTOR = 1.1;
// (high - low) / median above this marks a low-similarity set.
export const WIDE_SPREAD_RATIO = 0.5;
// Sold comps anchor the price only once there are at least this many of them.
export const MIN_SOLD_FOR_PREFERENCE = 2;

function isEligible(c: PricingComp): boolean {
  return (
    c.usedInPricing !== false &&
    c.ignoredAsOutlier !== true &&
    Number.isFinite(c.priceCents) &&
    c.priceCents > 0 &&
    Number.isFinite(c.shippingCents) &&
    c.shippingCents >= 0
  );
}

function totalCents(c: PricingComp): number {
  if (c.totalPriceCents != null && Number.isFinite(c.totalPriceCents) && c.totalPriceCents > 0) {
    return c.totalPriceCents;
  }
  return c.priceCents + (Number.isFinite(c.shippingCents) ? c.shippingCents : 0);
}

function median(sortedAsc: number[]): number {
  const n = sortedAsc.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1
    ? sortedAsc[mid]
    : Math.round((sortedAsc[mid - 1] + sortedAsc[mid]) / 2);
}

function allShare(set: PricingComp[], get: (c: PricingComp) => string | null | undefined): boolean {
  const values = set.map((c) => (get(c) ?? "").toString().trim().toLowerCase());
  return values.length > 0 && values.every((v) => v !== "" && v === values[0]);
}

function scoreConfidence(args: {
  set: PricingComp[];
  usingSold: boolean;
  soldCompCount: number;
  lowCents: number;
  highCents: number;
  medianCents: number;
}): { score: number; confidence: PricingConfidence; reasons: string[] } {
  const { set, usingSold, soldCompCount, lowCents, highCents, medianCents } = args;
  const reasons: string[] = [];
  let score = 0;

  const n = set.length;
  if (n >= 5) {
    score += 0.5;
    reasons.push(`${n} comps in the sample.`);
  } else if (n >= 3) {
    score += 0.35;
    reasons.push(`${n} comps in the sample.`);
  } else {
    score += 0.2;
    reasons.push(`Only ${n} comp${n === 1 ? "" : "s"} in the sample.`);
  }

  if (usingSold) {
    score += 0.2;
    reasons.push(`Anchored on ${soldCompCount} sold comp${soldCompCount === 1 ? "" : "s"}.`);
  } else if (soldCompCount > 0) {
    score += 0.05;
    reasons.push("Fewer than 2 sold comps; using all eligible comps.");
  } else {
    reasons.push("Active listings only (asking prices, not sales).");
  }

  const scored = set.filter(
    (c) => typeof c.matchScore === "number" && Number.isFinite(c.matchScore),
  );
  if (scored.length > 0) {
    const avg = scored.reduce((sum, c) => sum + (c.matchScore as number), 0) / scored.length;
    if (avg >= 0.8) {
      score += 0.15;
      reasons.push("Strong title/style match across comps.");
    } else if (avg >= 0.5) {
      score += 0.07;
      reasons.push("Moderate comp match.");
    } else {
      reasons.push("Weak comp match; treat the range loosely.");
    }
  }

  const now = new Date();
  const ages = set
    .map((c) =>
      c.soldDate ? (now.getTime() - new Date(c.soldDate).getTime()) / 86_400_000 : null,
    )
    .filter((d): d is number => d != null && Number.isFinite(d) && d >= 0);
  if (ages.length > 0) {
    const freshest = Math.min(...ages);
    if (freshest <= 30) {
      score += 0.1;
      reasons.push("Includes sales from the last 30 days.");
    } else if (freshest <= 90) {
      score += 0.05;
      reasons.push("Most recent sale within 90 days.");
    } else {
      reasons.push("Comps are older than 90 days.");
    }
  }

  if (allShare(set, (c) => c.brand)) {
    score += 0.05;
    reasons.push("Consistent brand across comps.");
  }
  if (allShare(set, (c) => c.size)) {
    score += 0.05;
    reasons.push("Consistent size across comps.");
  }
  if (allShare(set, (c) => c.condition)) {
    score += 0.05;
    reasons.push("Consistent condition across comps.");
  }

  const spread = medianCents > 0 ? (highCents - lowCents) / medianCents : 0;
  if (spread > WIDE_SPREAD_RATIO) {
    score -= 0.15;
    reasons.push("Wide price spread lowers confidence.");
  }

  score = Math.max(0, Math.min(1, Math.round(score * 100) / 100));
  const confidence: PricingConfidence =
    score >= 0.7 ? "high" : score >= 0.45 ? "medium" : "low";
  return { score, confidence, reasons };
}

export function calculatePricing(comps: PricingComp[]): PricingSummary {
  const eligible = comps.filter(isEligible);
  const soldCompCount = eligible.filter((c) => c.status === "sold").length;
  const activeCompCount = eligible.filter((c) => c.status === "active").length;

  if (eligible.length === 0) {
    return {
      status: "needs_comps",
      totalComps: comps.length,
      validComps: 0,
      compCount: 0,
      soldCompCount: 0,
      activeCompCount: 0,
      lowCents: null,
      medianCents: null,
      averageCents: null,
      highCents: null,
      quickSaleCents: null,
      recommendedListCents: null,
      confidence: "none",
      confidenceScore: 0,
      confidenceReasons: ["No comps yet. Add real sold or active comps."],
    };
  }

  const soldEligible = eligible.filter((c) => c.status === "sold");
  const usingSold = soldEligible.length >= MIN_SOLD_FOR_PREFERENCE;
  const anchorSet = usingSold ? soldEligible : eligible;

  const totals = anchorSet.map(totalCents).sort((a, b) => a - b);
  const lowCents = totals[0];
  const highCents = totals[totals.length - 1];
  const medianCents = median(totals);
  const averageCents = Math.round(totals.reduce((sum, t) => sum + t, 0) / totals.length);

  const { score, confidence, reasons } = scoreConfidence({
    set: anchorSet,
    usingSold,
    soldCompCount,
    lowCents,
    highCents,
    medianCents,
  });

  return {
    status: "ready",
    totalComps: comps.length,
    validComps: eligible.length,
    compCount: eligible.length,
    soldCompCount,
    activeCompCount,
    lowCents,
    medianCents,
    averageCents,
    highCents,
    quickSaleCents: Math.round(medianCents * QUICK_SALE_FACTOR),
    recommendedListCents: Math.round(medianCents * LIST_PREMIUM_FACTOR),
    confidence,
    confidenceScore: score,
    confidenceReasons: reasons,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/pricing/comps.test.ts`
Expected: PASS (all cases).

---

## Task 3: Zod schemas — extended create + new update schema

**Files:**
- Modify: `src/lib/pricing/price-comp-input.ts`
- Test: `src/lib/pricing/price-comp-input.test.ts` (full rewrite)

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `src/lib/pricing/price-comp-input.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  CreatePriceCompRequestSchema,
  PriceCompInputSchema,
  UpdatePriceCompSchema,
} from "./price-comp-input";

describe("PriceCompInputSchema", () => {
  it("accepts a minimal manual comp and applies v2 defaults", () => {
    const parsed = PriceCompInputSchema.parse({
      source: "eBay sold",
      title: "Air Jordan 1",
      priceCents: 22500,
    });
    expect(parsed.shippingCents).toBe(0);
    expect(parsed.condition).toBe("unknown");
    expect(parsed.sourceType).toBe("manual");
    expect(parsed.status).toBe("unknown");
    expect(parsed.currency).toBe("USD");
  });

  it("accepts the new optional v2 fields", () => {
    const parsed = PriceCompInputSchema.parse({
      source: "StockX",
      title: "Air Jordan 1",
      priceCents: 22500,
      status: "sold",
      platform: "stockx",
      brand: "Nike",
      size: "10.5",
      matchScore: 0.92,
      totalPriceCents: 24000,
      usedInPricing: true,
      ignoredAsOutlier: false,
    });
    expect(parsed.status).toBe("sold");
    expect(parsed.matchScore).toBe(0.92);
  });

  it("rejects a non-positive price", () => {
    expect(() =>
      PriceCompInputSchema.parse({ source: "x", title: "y", priceCents: 0 }),
    ).toThrow();
  });

  it("rejects an out-of-range match score", () => {
    expect(() =>
      PriceCompInputSchema.parse({ source: "x", title: "y", priceCents: 100, matchScore: 1.5 }),
    ).toThrow();
  });

  it("rejects an invalid status enum value", () => {
    expect(() =>
      PriceCompInputSchema.parse({ source: "x", title: "y", priceCents: 100, status: "pending" }),
    ).toThrow();
  });

  it("rejects non-http(s) comp URLs (no javascript: scheme)", () => {
    expect(() =>
      PriceCompInputSchema.parse({
        source: "x",
        title: "y",
        priceCents: 100,
        url: "javascript:alert(1)",
      }),
    ).toThrow();
  });

  it("accepts a normal https comp URL", () => {
    const parsed = PriceCompInputSchema.parse({
      source: "x",
      title: "y",
      priceCents: 100,
      url: "https://www.ebay.com/itm/123",
    });
    expect(parsed.url).toBe("https://www.ebay.com/itm/123");
  });
});

describe("CreatePriceCompRequestSchema", () => {
  it("requires a uuid inventory item id", () => {
    expect(() =>
      CreatePriceCompRequestSchema.parse({
        inventoryItemId: "not-a-uuid",
        comp: { source: "x", title: "y", priceCents: 100 },
      }),
    ).toThrow();
  });
});

describe("UpdatePriceCompSchema", () => {
  it("accepts a partial update of a single field", () => {
    const parsed = UpdatePriceCompSchema.parse({ usedInPricing: false });
    expect(parsed.usedInPricing).toBe(false);
  });

  it("accepts toggling the outlier flag and status", () => {
    const parsed = UpdatePriceCompSchema.parse({ ignoredAsOutlier: true, status: "active" });
    expect(parsed.ignoredAsOutlier).toBe(true);
    expect(parsed.status).toBe("active");
  });

  it("rejects an empty update body", () => {
    expect(() => UpdatePriceCompSchema.parse({})).toThrow();
  });

  it("rejects unknown fields (strict)", () => {
    expect(() => UpdatePriceCompSchema.parse({ bogus: 1 })).toThrow();
  });

  it("rejects a non-http(s) image url", () => {
    expect(() => UpdatePriceCompSchema.parse({ imageUrl: "data:image/png;base64,AAA" })).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/pricing/price-comp-input.test.ts`
Expected: FAIL (`UpdatePriceCompSchema` not exported; new fields rejected).

- [ ] **Step 3: Rewrite `src/lib/pricing/price-comp-input.ts`**

Replace the entire file:

```ts
import { z } from "zod";

import { ConditionSchema } from "../ai/listing-draft";

// Comp URLs are rendered as clickable links, so only allow http(s) to keep a
// stored `javascript:`/`data:` URL from becoming a script-execution vector.
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export const CompSourceTypeSchema = z.enum(["manual", "api", "scraper", "visual_search"]);
export const CompStatusSchema = z.enum(["sold", "active", "unknown"]);

const httpUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine(isHttpUrl, "URL must use http or https.");

export const PriceCompInputSchema = z
  .object({
    source: z.string().trim().min(1).max(80),
    sourceType: CompSourceTypeSchema.default("manual"),
    platform: z.string().trim().max(60).nullable().optional(),
    status: CompStatusSchema.default("unknown"),
    title: z.string().trim().min(1).max(200),
    brand: z.string().trim().max(80).nullable().optional(),
    size: z.string().trim().max(40).nullable().optional(),
    priceCents: z.number().int().positive(),
    shippingCents: z.number().int().min(0).default(0),
    totalPriceCents: z.number().int().positive().nullable().optional(),
    currency: z.string().trim().length(3).default("USD"),
    soldDate: z.coerce.date().nullable().optional(),
    url: httpUrl.nullable().optional(),
    imageUrl: httpUrl.nullable().optional(),
    condition: ConditionSchema.default("unknown"),
    matchScore: z.number().min(0).max(1).nullable().optional(),
    usedInPricing: z.boolean().default(true),
    ignoredAsOutlier: z.boolean().default(false),
    rawJson: z.unknown().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export type PriceCompInput = z.infer<typeof PriceCompInputSchema>;

export const CreatePriceCompRequestSchema = z
  .object({
    inventoryItemId: z.uuid(),
    comp: PriceCompInputSchema,
  })
  .strict();

export type CreatePriceCompRequest = z.infer<typeof CreatePriceCompRequestSchema>;

// Every field optional; at least one required. Used by PATCH /comps/[compId].
export const UpdatePriceCompSchema = z
  .object({
    source: z.string().trim().min(1).max(80).optional(),
    sourceType: CompSourceTypeSchema.optional(),
    platform: z.string().trim().max(60).nullable().optional(),
    status: CompStatusSchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    brand: z.string().trim().max(80).nullable().optional(),
    size: z.string().trim().max(40).nullable().optional(),
    priceCents: z.number().int().positive().optional(),
    shippingCents: z.number().int().min(0).optional(),
    totalPriceCents: z.number().int().positive().nullable().optional(),
    currency: z.string().trim().length(3).optional(),
    soldDate: z.coerce.date().nullable().optional(),
    url: httpUrl.nullable().optional(),
    imageUrl: httpUrl.nullable().optional(),
    condition: ConditionSchema.optional(),
    matchScore: z.number().min(0).max(1).nullable().optional(),
    usedInPricing: z.boolean().optional(),
    ignoredAsOutlier: z.boolean().optional(),
    rawJson: z.unknown().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, { message: "No fields to update." });

export type UpdatePriceCompInput = z.infer<typeof UpdatePriceCompSchema>;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/pricing/price-comp-input.test.ts`
Expected: PASS.

---

## Task 4: Shared summarizer + API (persist v2 fields on POST, PATCH/DELETE one comp)

**Files:**
- Create: `src/lib/pricing/summarize.ts`
- Modify: `src/app/api/listings/comps/route.ts`
- Create: `src/app/api/listings/comps/[compId]/route.ts`
- Test: `src/app/api/listings/comps/[compId]/route.test.ts`

- [ ] **Step 1: Create the shared summarizer**

Create `src/lib/pricing/summarize.ts`:

```ts
import { calculatePricing, type PricingSummary } from "@/lib/pricing/comps";

// Structural row type — assignable from a Prisma PriceComp findMany result, but
// decoupled from the generated client so this stays a pure utility.
export type PriceCompRow = {
  priceCents: number;
  shippingCents: number;
  totalPriceCents: number | null;
  status: "sold" | "active" | "unknown";
  usedInPricing: boolean;
  ignoredAsOutlier: boolean;
  matchScore: number | null;
  soldDate: Date | null;
  brand: string | null;
  size: string | null;
  condition: string | null;
};

export function summarizeComps(comps: PriceCompRow[]): PricingSummary {
  return calculatePricing(
    comps.map((c) => ({
      priceCents: c.priceCents,
      shippingCents: c.shippingCents,
      totalPriceCents: c.totalPriceCents,
      status: c.status,
      usedInPricing: c.usedInPricing,
      ignoredAsOutlier: c.ignoredAsOutlier,
      matchScore: c.matchScore,
      soldDate: c.soldDate,
      brand: c.brand,
      size: c.size,
      condition: c.condition,
    })),
  );
}
```

- [ ] **Step 2: Update `src/app/api/listings/comps/route.ts`**

Replace the entire file (swaps the local `summarize` for the shared one, persists the new fields on POST):

```ts
import { NextResponse } from "next/server";

import type { Prisma } from "@/generated/prisma/client";
import { AppError, getErrorMessage } from "@/lib/errors";
import { calculatePricing } from "@/lib/pricing/comps";
import { CreatePriceCompRequestSchema } from "@/lib/pricing/price-comp-input";
import { summarizeComps } from "@/lib/pricing/summarize";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const prisma = getPrisma();

    const requestedItemId = new URL(request.url).searchParams.get("inventoryItemId");

    const inventoryItem = requestedItemId
      ? await prisma.inventoryItem.findFirst({
          where: { id: requestedItemId, sellerId: user.id },
          select: { id: true },
        })
      : await prisma.inventoryItem.findFirst({
          where: { sellerId: user.id },
          orderBy: { updatedAt: "desc" },
          select: { id: true },
        });

    if (!inventoryItem) {
      return NextResponse.json({
        inventoryItemId: null,
        comps: [],
        summary: calculatePricing([]),
      });
    }

    const comps = await prisma.priceComp.findMany({
      where: { inventoryItemId: inventoryItem.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      inventoryItemId: inventoryItem.id,
      comps,
      summary: summarizeComps(comps),
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const { inventoryItemId, comp } = CreatePriceCompRequestSchema.parse(
      await request.json(),
    );
    const prisma = getPrisma();

    const inventoryItem = await prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, sellerId: user.id },
      select: { id: true },
    });

    if (!inventoryItem) {
      throw new AppError("Inventory item not found.", 404);
    }

    await prisma.priceComp.create({
      data: {
        inventoryItemId: inventoryItem.id,
        source: comp.source,
        sourceType: comp.sourceType,
        platform: comp.platform ?? null,
        status: comp.status,
        title: comp.title,
        brand: comp.brand ?? null,
        size: comp.size ?? null,
        priceCents: comp.priceCents,
        shippingCents: comp.shippingCents,
        totalPriceCents: comp.totalPriceCents ?? null,
        currency: comp.currency,
        soldDate: comp.soldDate ?? null,
        url: comp.url ?? null,
        imageUrl: comp.imageUrl ?? null,
        condition: comp.condition,
        matchScore: comp.matchScore ?? null,
        usedInPricing: comp.usedInPricing,
        ignoredAsOutlier: comp.ignoredAsOutlier,
        rawJson:
          comp.rawJson === undefined
            ? undefined
            : (comp.rawJson as Prisma.InputJsonValue),
        notes: comp.notes ?? null,
      },
    });

    const comps = await prisma.priceComp.findMany({
      where: { inventoryItemId: inventoryItem.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      inventoryItemId: inventoryItem.id,
      comps,
      summary: summarizeComps(comps),
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
```

- [ ] **Step 3: Write the failing PATCH/DELETE auth tests**

Create `src/app/api/listings/comps/[compId]/route.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { DELETE, PATCH } from "./route";

const params = Promise.resolve({ compId: "11111111-1111-1111-1111-111111111111" });

describe("price comp [compId] API auth boundaries", () => {
  it("rejects updating a comp when the seller is not signed in", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/listings/comps/abc", {
        method: "PATCH",
        body: JSON.stringify({ usedInPricing: false }),
      }),
      { params },
    );
    const payload = await response.json();
    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });

  it("rejects deleting a comp when the seller is not signed in", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/listings/comps/abc", { method: "DELETE" }),
      { params },
    );
    const payload = await response.json();
    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx vitest run "src/app/api/listings/comps/[compId]/route.test.ts"`
Expected: FAIL — module `./route` does not exist.

- [ ] **Step 5: Create `src/app/api/listings/comps/[compId]/route.ts`**

```ts
import { NextResponse } from "next/server";

import type { Prisma } from "@/generated/prisma/client";
import { AppError, getErrorMessage } from "@/lib/errors";
import { UpdatePriceCompSchema, type UpdatePriceCompInput } from "@/lib/pricing/price-comp-input";
import { summarizeComps } from "@/lib/pricing/summarize";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Context = { params: Promise<{ compId: string }> };

// Only copy keys the caller actually sent, converting where the DB type differs.
function toUpdateData(update: UpdatePriceCompInput): Prisma.PriceCompUpdateInput {
  const data: Prisma.PriceCompUpdateInput = {};
  if (update.source !== undefined) data.source = update.source;
  if (update.sourceType !== undefined) data.sourceType = update.sourceType;
  if (update.platform !== undefined) data.platform = update.platform;
  if (update.status !== undefined) data.status = update.status;
  if (update.title !== undefined) data.title = update.title;
  if (update.brand !== undefined) data.brand = update.brand;
  if (update.size !== undefined) data.size = update.size;
  if (update.priceCents !== undefined) data.priceCents = update.priceCents;
  if (update.shippingCents !== undefined) data.shippingCents = update.shippingCents;
  if (update.totalPriceCents !== undefined) data.totalPriceCents = update.totalPriceCents;
  if (update.currency !== undefined) data.currency = update.currency;
  if (update.soldDate !== undefined) data.soldDate = update.soldDate;
  if (update.url !== undefined) data.url = update.url;
  if (update.imageUrl !== undefined) data.imageUrl = update.imageUrl;
  if (update.condition !== undefined) data.condition = update.condition;
  if (update.matchScore !== undefined) data.matchScore = update.matchScore;
  if (update.usedInPricing !== undefined) data.usedInPricing = update.usedInPricing;
  if (update.ignoredAsOutlier !== undefined) data.ignoredAsOutlier = update.ignoredAsOutlier;
  if (update.notes !== undefined) data.notes = update.notes;
  if (update.rawJson !== undefined) {
    data.rawJson = update.rawJson as Prisma.InputJsonValue;
  }
  return data;
}

async function loadOwnedComp(request: Request, compId: string) {
  const user = await requireSupabaseUser(request);
  const prisma = getPrisma();
  const existing = await prisma.priceComp.findFirst({
    where: { id: compId, inventoryItem: { sellerId: user.id } },
    select: { id: true, inventoryItemId: true },
  });
  if (!existing) {
    throw new AppError("Comp not found.", 404);
  }
  return { prisma, existing };
}

async function respondWithComps(
  prisma: ReturnType<typeof getPrisma>,
  inventoryItemId: string,
) {
  const comps = await prisma.priceComp.findMany({
    where: { inventoryItemId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    inventoryItemId,
    comps,
    summary: summarizeComps(comps),
  });
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { compId } = await context.params;
    const update = UpdatePriceCompSchema.parse(await request.json());
    const { prisma, existing } = await loadOwnedComp(request, compId);

    await prisma.priceComp.update({
      where: { id: existing.id },
      data: toUpdateData(update),
    });

    return respondWithComps(prisma, existing.inventoryItemId);
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { compId } = await context.params;
    const { prisma, existing } = await loadOwnedComp(request, compId);

    await prisma.priceComp.delete({ where: { id: existing.id } });

    return respondWithComps(prisma, existing.inventoryItemId);
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
```

> NOTE: `requireSupabaseUser` runs first inside `loadOwnedComp`, so an unauthenticated request 401s before any DB access — matching the existing route's behavior and the tests above. In PATCH, `UpdatePriceCompSchema.parse` runs before auth; for the unauthenticated test the body `{ usedInPricing: false }` is valid, so parsing passes and auth still produces the 401. (Do not reorder so that an invalid body could 400 before auth — keep parse → auth as written; the valid test body keeps the 401 assertion correct.)

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run "src/app/api/listings/comps/[compId]/route.test.ts" "src/app/api/listings/comps/route.test.ts"`
Expected: PASS (new PATCH/DELETE auth tests + the existing GET/POST auth tests still green).

---

## Task 5: Provider stubs + registry

**Files:**
- Create: `src/lib/comps/sources/apify-ebay-sold.ts`, `grailed-sold.ts`, `poshmark-sold.ts`, `depop-active.ts`, `google-lens.ts`
- Modify: `src/lib/comps/registry.ts`, `src/lib/comps/normalize.ts`
- Test: `src/lib/comps/sources/stubs.test.ts`

- [ ] **Step 1: Write the failing stub test**

Create `src/lib/comps/sources/stubs.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

import { apifyEbaySoldSource } from "./apify-ebay-sold";
import { depopActiveSource } from "./depop-active";
import { googleLensSource } from "./google-lens";
import { grailedSoldSource } from "./grailed-sold";
import { poshmarkSoldSource } from "./poshmark-sold";
import type { CompQuery } from "@/lib/comps/source";

const query: CompQuery = {
  styleCode: null,
  brand: "Nike",
  title: "Air Jordan 1",
  size: "10",
  category: "sneakers",
  keywords: "Nike Air Jordan 1",
};

const cases = [
  { source: apifyEbaySoldSource, env: "APIFY_TOKEN", sold: true },
  { source: grailedSoldSource, env: "GRAILED_COMPS_API_KEY", sold: true },
  { source: poshmarkSoldSource, env: "POSHMARK_COMPS_API_KEY", sold: true },
  { source: depopActiveSource, env: "DEPOP_COMPS_API_KEY", sold: false },
  { source: googleLensSource, env: "GOOGLE_LENS_API_KEY", sold: false },
];

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("external comp source stubs", () => {
  for (const { source, env, sold } of cases) {
    it(`${source.id} is disabled without ${env} and reports sold=${sold}`, () => {
      vi.stubEnv(env, "");
      expect(source.isEnabled()).toBe(false);
      expect(source.sold).toBe(sold);
    });

    it(`${source.id} is enabled once ${env} is set`, () => {
      vi.stubEnv(env, "configured");
      expect(source.isEnabled()).toBe(true);
    });

    it(`${source.id} returns no invented comps`, async () => {
      vi.stubEnv(env, "configured");
      await expect(source.fetchComps(query)).resolves.toEqual([]);
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/comps/sources/stubs.test.ts`
Expected: FAIL — the five modules don't exist.

- [ ] **Step 3: Create the five stubs**

Create `src/lib/comps/sources/apify-ebay-sold.ts`:

```ts
import type { CompQuery, CompSource, NormalizedComp } from "@/lib/comps/source";

// Apify eBay sold-listings actor. Sold comps via a third-party scraper service
// (not eBay Marketplace Insights, which is access-restricted). Gated on
// APIFY_TOKEN; returns [] until the actor integration is built.
export const apifyEbaySoldSource: CompSource = {
  id: "apify-ebay-sold",
  displayName: "eBay sold (Apify)",
  sold: true,
  isEnabled() {
    return Boolean(process.env.APIFY_TOKEN);
  },
  async fetchComps(_query: CompQuery): Promise<NormalizedComp[]> {
    void _query;
    // TODO: call the Apify eBay-sold actor once the integration is built.
    return [];
  },
};
```

Create `src/lib/comps/sources/grailed-sold.ts`:

```ts
import type { CompQuery, CompSource, NormalizedComp } from "@/lib/comps/source";

// Grailed sold comps (streetwear/designer). Gated on GRAILED_COMPS_API_KEY;
// returns [] until a data provider is wired in.
export const grailedSoldSource: CompSource = {
  id: "grailed-sold",
  displayName: "Grailed sold",
  sold: true,
  isEnabled() {
    return Boolean(process.env.GRAILED_COMPS_API_KEY);
  },
  async fetchComps(_query: CompQuery): Promise<NormalizedComp[]> {
    void _query;
    // TODO: implement once a Grailed comp data source is available.
    return [];
  },
};
```

Create `src/lib/comps/sources/poshmark-sold.ts`:

```ts
import type { CompQuery, CompSource, NormalizedComp } from "@/lib/comps/source";

// Poshmark sold comps. Gated on POSHMARK_COMPS_API_KEY; returns [] until wired.
export const poshmarkSoldSource: CompSource = {
  id: "poshmark-sold",
  displayName: "Poshmark sold",
  sold: true,
  isEnabled() {
    return Boolean(process.env.POSHMARK_COMPS_API_KEY);
  },
  async fetchComps(_query: CompQuery): Promise<NormalizedComp[]> {
    void _query;
    // TODO: implement once a Poshmark comp data source is available.
    return [];
  },
};
```

Create `src/lib/comps/sources/depop-active.ts`:

```ts
import type { CompQuery, CompSource, NormalizedComp } from "@/lib/comps/source";

// Depop active listings (asking prices, not sales). Gated on DEPOP_COMPS_API_KEY;
// returns [] until wired.
export const depopActiveSource: CompSource = {
  id: "depop-active",
  displayName: "Depop (active listings)",
  sold: false,
  isEnabled() {
    return Boolean(process.env.DEPOP_COMPS_API_KEY);
  },
  async fetchComps(_query: CompQuery): Promise<NormalizedComp[]> {
    void _query;
    // TODO: implement once a Depop comp data source is available.
    return [];
  },
};
```

Create `src/lib/comps/sources/google-lens.ts`:

```ts
import type { CompQuery, CompSource, NormalizedComp } from "@/lib/comps/source";

// Google Lens visual search (visual_search source type). Gated on
// GOOGLE_LENS_API_KEY; returns [] until wired. Reports sold=false (visual
// matches are listings/links, not confirmed sales).
export const googleLensSource: CompSource = {
  id: "google-lens",
  displayName: "Google Lens",
  sold: false,
  isEnabled() {
    return Boolean(process.env.GOOGLE_LENS_API_KEY);
  },
  async fetchComps(_query: CompQuery): Promise<NormalizedComp[]> {
    void _query;
    // TODO: implement once a Google Lens / visual search provider is wired in.
    return [];
  },
};
```

- [ ] **Step 4: Register the stubs**

Replace the entire contents of `src/lib/comps/registry.ts`:

```ts
import { apifyEbaySoldSource } from "@/lib/comps/sources/apify-ebay-sold";
import { depopActiveSource } from "@/lib/comps/sources/depop-active";
import { ebayBrowseSource } from "@/lib/comps/sources/ebay-browse";
import { googleLensSource } from "@/lib/comps/sources/google-lens";
import { grailedSoldSource } from "@/lib/comps/sources/grailed-sold";
import { poshmarkSoldSource } from "@/lib/comps/sources/poshmark-sold";
import { stockxSource } from "@/lib/comps/sources/stockx";
import type { CompSource } from "@/lib/comps/source";

// Sold sources first (preferred), active/visual sources last (interim signals).
// All are env-gated: a source with no configured credentials reports
// isEnabled() === false and is skipped, so nothing runs unless configured.
// Note: eBay Marketplace Insights is intentionally absent (access restricted).
export const COMP_SOURCES: CompSource[] = [
  stockxSource,
  apifyEbaySoldSource,
  grailedSoldSource,
  poshmarkSoldSource,
  ebayBrowseSource,
  depopActiveSource,
  googleLensSource,
];

export function enabledCompSources(): CompSource[] {
  return COMP_SOURCES.filter((source) => source.isEnabled());
}
```

- [ ] **Step 5: Map status + sourceType for auto comps in `normalize.ts`**

In `src/lib/comps/normalize.ts`, update `toPriceCompCreate` so refreshed automatic comps carry the new fields (status from `c.sold`, sourceType `api`). Replace the function:

```ts
// Maps a normalized comp to PriceComp create data. The source is prefixed
// "auto:" so refreshed automatic comps can be replaced without touching any
// manually entered comps.
export function toPriceCompCreate(inventoryItemId: string, c: NormalizedComp) {
  return {
    inventoryItemId,
    source: `auto:${c.source}`,
    sourceType: "api" as const,
    status: (c.sold ? "sold" : "active") as "sold" | "active",
    title: c.title.slice(0, 200),
    priceCents: c.priceCents,
    shippingCents: c.shippingCents,
    soldDate: c.soldDate ? new Date(c.soldDate) : null,
    url: c.url && /^https?:\/\//i.test(c.url) ? c.url.slice(0, 500) : null,
    notes: c.sold ? "Sold comp" : "Active listing",
  };
}
```

- [ ] **Step 6: Run to verify it passes (and the existing pipeline test still passes)**

Run: `npx vitest run src/lib/comps/sources/stubs.test.ts src/lib/comps/comps.test.ts`
Expected: PASS. The existing `toPriceCompCreate` test only asserts `source` + `url`, so adding fields keeps it green.

---

## Task 6: Comps panel UI — pure subcomponents + edit/delete/toggles/status/median

**Files:**
- Modify: `src/app/comps-panel.tsx` (full rewrite — split into exported pure `PricingRecommendationCard` + `CompsTable` and the interactive container)
- Test: `src/app/comps-panel.test.tsx`

- [ ] **Step 1: Write the failing UI render test**

Create `src/app/comps-panel.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CompsTable, PricingRecommendationCard, type CompRow, type Summary } from "./comps-panel";

function readySummary(overrides: Partial<Summary> = {}): Summary {
  return {
    status: "ready",
    totalComps: 4,
    validComps: 4,
    compCount: 4,
    soldCompCount: 3,
    activeCompCount: 1,
    lowCents: 18000,
    medianCents: 20000,
    averageCents: 21000,
    highCents: 26000,
    quickSaleCents: 18000,
    recommendedListCents: 22000,
    confidence: "medium",
    confidenceScore: 0.55,
    confidenceReasons: ["Anchored on 3 sold comps.", "Consistent brand across comps."],
    ...overrides,
  };
}

function row(overrides: Partial<CompRow> = {}): CompRow {
  return {
    id: "comp-1",
    source: "StockX",
    platform: "stockx",
    status: "sold",
    title: "Air Jordan 1",
    brand: "Nike",
    size: "10",
    priceCents: 20000,
    shippingCents: 0,
    totalPriceCents: null,
    soldDate: null,
    url: null,
    condition: "used_good",
    usedInPricing: true,
    ignoredAsOutlier: false,
    notes: null,
    ...overrides,
  };
}

describe("PricingRecommendationCard", () => {
  it("renders median, sold/active counts, and confidence reasons", () => {
    const html = renderToStaticMarkup(<PricingRecommendationCard summary={readySummary()} />);
    expect(html).toContain("Median");
    expect(html).toContain("$200.00"); // median 20000c
    expect(html).toContain("3 sold");
    expect(html).toContain("1 active");
    expect(html).toContain("Anchored on 3 sold comps.");
  });

  it("renders the needs-comps empty state", () => {
    const empty = readySummary({
      status: "needs_comps",
      compCount: 0,
      soldCompCount: 0,
      activeCompCount: 0,
      medianCents: null,
      confidence: "none",
      confidenceReasons: ["No comps yet. Add real sold or active comps."],
    });
    const html = renderToStaticMarkup(<PricingRecommendationCard summary={empty} />);
    expect(html).toContain("Add sold or active comps");
  });
});

describe("CompsTable", () => {
  it("renders status, the pricing toggles, and edit/delete controls", () => {
    const html = renderToStaticMarkup(
      <CompsTable comps={[row()]} onEdit={() => {}} onDelete={() => {}} onToggle={() => {}} />,
    );
    expect(html).toContain("Air Jordan 1");
    expect(html).toContain("sold");
    expect(html).toContain("Use in pricing");
    expect(html).toContain("Outlier");
    expect(html).toContain("Edit");
    expect(html).toContain("Delete");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/comps-panel.test.tsx`
Expected: FAIL — `PricingRecommendationCard` / `CompsTable` / types not exported.

- [ ] **Step 3: Rewrite `src/app/comps-panel.tsx`**

Replace the entire file:

```tsx
"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Loader2, Pencil, Plus, Trash2, X } from "lucide-react";

export type Confidence = "none" | "low" | "medium" | "high";
export type CompStatus = "sold" | "active" | "unknown";

export type Summary = {
  status: "needs_comps" | "ready";
  totalComps: number;
  validComps: number;
  compCount: number;
  soldCompCount: number;
  activeCompCount: number;
  lowCents: number | null;
  medianCents: number | null;
  averageCents: number | null;
  highCents: number | null;
  quickSaleCents: number | null;
  recommendedListCents: number | null;
  confidence: Confidence;
  confidenceScore: number;
  confidenceReasons: string[];
};

export type CompRow = {
  id: string;
  source: string;
  platform: string | null;
  status: CompStatus;
  title: string;
  brand: string | null;
  size: string | null;
  priceCents: number;
  shippingCents: number;
  totalPriceCents: number | null;
  soldDate: string | null;
  url: string | null;
  condition: string;
  usedInPricing: boolean;
  ignoredAsOutlier: boolean;
  notes: string | null;
};

type CompsResponse = { comps: CompRow[]; summary: Summary };

const conditionOptions = [
  "new_with_tags",
  "new_without_tags",
  "used_excellent",
  "used_good",
  "used_fair",
  "for_parts",
  "unknown",
] as const;

const platformOptions = [
  "",
  "ebay",
  "stockx",
  "grailed",
  "poshmark",
  "depop",
  "goat",
  "other",
] as const;

const statusOptions: CompStatus[] = ["sold", "active", "unknown"];

const emptyForm = {
  source: "",
  platform: "",
  status: "sold" as CompStatus,
  title: "",
  brand: "",
  size: "",
  price: "",
  shipping: "",
  soldDate: "",
  url: "",
  condition: "unknown",
  notes: "",
};

type FormState = typeof emptyForm;

export function formatCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );
}

function isHttpUrl(value: string) {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function dollarsToCents(value: string) {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed * 100) : null;
}

function nonNegativeCents(value: string) {
  if (!value.trim()) return 0;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}

const confidenceStyles: Record<Confidence, string> = {
  none: "border-neutral-300 bg-neutral-100 text-neutral-600",
  low: "border-amber-300 bg-amber-50 text-amber-900",
  medium: "border-sky-300 bg-sky-50 text-sky-900",
  high: "border-emerald-300 bg-emerald-50 text-emerald-900",
};

const statusStyles: Record<CompStatus, string> = {
  sold: "bg-emerald-100 text-emerald-800",
  active: "bg-sky-100 text-sky-800",
  unknown: "bg-neutral-100 text-neutral-600",
};

// ---- Pure presentational components (rendered in tests via renderToStaticMarkup) ----

export function PricingRecommendationCard({ summary }: { summary: Summary }) {
  const needsComps = summary.status === "needs_comps";
  const tiles: Array<[string, number | null]> = [
    ["Low", summary.lowCents],
    ["Median", summary.medianCents],
    ["Average", summary.averageCents],
    ["High", summary.highCents],
    ["Quick sale", summary.quickSaleCents],
    ["Recommended", summary.recommendedListCents],
  ];

  return (
    <div className="border border-neutral-300 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-neutral-500">
          Comp-based pricing
        </h3>
        <span
          className={`border px-2 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${confidenceStyles[summary.confidence]}`}
        >
          {summary.confidence === "none" ? "Needs comps" : `${summary.confidence} confidence`}
        </span>
      </div>

      {needsComps ? (
        <p className="mt-3 text-sm text-neutral-600">
          Add sold or active comps to improve pricing confidence. Pricing is never invented
          without comps.
        </p>
      ) : (
        <>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {tiles.map(([label, value]) => (
              <div
                key={label}
                className={`border p-3 ${label === "Median" ? "border-neutral-900" : "border-neutral-200"}`}
              >
                <dt className="text-xs uppercase tracking-[0.12em] text-neutral-500">{label}</dt>
                <dd className="mt-1 text-base font-semibold">{formatCents(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-neutral-500">
            {summary.soldCompCount} sold · {summary.activeCompCount} active · {summary.compCount}{" "}
            used of {summary.totalComps} total. You can override the final price in the editor.
          </p>
          {summary.confidenceReasons.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-neutral-600">
              {summary.confidenceReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </div>
  );
}

export function CompsTable({
  comps,
  onEdit,
  onDelete,
  onToggle,
  busyId,
}: {
  comps: CompRow[];
  onEdit: (comp: CompRow) => void;
  onDelete: (comp: CompRow) => void;
  onToggle: (comp: CompRow, field: "usedInPricing" | "ignoredAsOutlier") => void;
  busyId?: string | null;
}) {
  return (
    <div className="border border-neutral-300 bg-white">
      <div className="border-b border-neutral-200 p-4">
        <p className="text-sm font-semibold">Comps ({comps.length})</p>
      </div>
      {comps.length === 0 ? (
        <p className="p-4 text-sm text-neutral-500">
          No comps yet. Add sold or active comps to improve pricing confidence.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-[0.12em] text-neutral-500">
              <tr>
                <th className="px-3 py-3 font-medium">Source</th>
                <th className="px-3 py-3 font-medium">Title</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Total</th>
                <th className="px-3 py-3 font-medium">Use in pricing</th>
                <th className="px-3 py-3 font-medium">Outlier</th>
                <th className="px-3 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {comps.map((comp) => {
                const total = comp.totalPriceCents ?? comp.priceCents + comp.shippingCents;
                return (
                  <tr key={comp.id} className="border-b border-neutral-100 align-top">
                    <td className="px-3 py-3">
                      {comp.source}
                      {comp.platform ? (
                        <span className="block text-xs text-neutral-400">{comp.platform}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      {comp.url && isHttpUrl(comp.url) ? (
                        <a
                          href={comp.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-red-700 underline"
                        >
                          {comp.title}
                        </a>
                      ) : (
                        comp.title
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className={`px-2 py-0.5 text-xs font-medium capitalize ${statusStyles[comp.status]}`}
                      >
                        {comp.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 font-medium">{formatCents(total)}</td>
                    <td className="px-3 py-3">
                      <label className="inline-flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={comp.usedInPricing}
                          disabled={busyId === comp.id}
                          onChange={() => onToggle(comp, "usedInPricing")}
                          aria-label="Use in pricing"
                        />
                        <span className="sr-only">Use in pricing</span>
                      </label>
                    </td>
                    <td className="px-3 py-3">
                      <label className="inline-flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={comp.ignoredAsOutlier}
                          disabled={busyId === comp.id}
                          onChange={() => onToggle(comp, "ignoredAsOutlier")}
                          aria-label="Ignore as outlier"
                        />
                        <span className="sr-only">Outlier</span>
                      </label>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => onEdit(comp)}
                          className="inline-flex items-center gap-1 border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-50"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(comp)}
                          disabled={busyId === comp.id}
                          className="inline-flex items-center gap-1 border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60"
                        >
                          <Trash2 className="h-3 w-3" /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Interactive container ----

export default function CompsPanel({
  accessToken,
  inventoryItemId,
}: {
  accessToken: string;
  inventoryItemId: string;
}) {
  const [comps, setComps] = useState<CompRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadComps() {
      setIsLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/listings/comps?inventoryItemId=${encodeURIComponent(inventoryItemId)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const payload = (await response.json()) as CompsResponse & { error?: string };
        if (cancelled) return;
        if (!response.ok) throw new Error(payload.error ?? "Could not load comps.");
        setComps(payload.comps);
        setSummary(payload.summary);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Could not load comps.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadComps();
    return () => {
      cancelled = true;
    };
  }, [accessToken, inventoryItemId]);

  function applyResponse(payload: CompsResponse) {
    setComps(payload.comps);
    setSummary(payload.summary);
  }

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const priceCents = dollarsToCents(form.price);
    if (priceCents == null) {
      setError("Enter a comp price greater than $0.");
      return;
    }
    const shippingCents = nonNegativeCents(form.shipping);
    if (shippingCents == null) {
      setError("Shipping must be $0 or more.");
      return;
    }

    setIsSaving(true);
    setError("");

    const compBody = {
      source: form.source,
      platform: form.platform ? form.platform : null,
      status: form.status,
      title: form.title,
      brand: form.brand ? form.brand : null,
      size: form.size ? form.size : null,
      priceCents,
      shippingCents,
      soldDate: form.soldDate ? form.soldDate : null,
      url: form.url ? form.url : null,
      condition: form.condition,
      notes: form.notes ? form.notes : null,
    };

    try {
      const response = editingId
        ? await fetch(`/api/listings/comps/${editingId}`, {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(compBody),
          })
        : await fetch("/api/listings/comps", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ inventoryItemId, comp: compBody }),
          });

      const payload = (await response.json()) as CompsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not save the comp.");
      applyResponse(payload);
      resetForm();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save the comp.");
    } finally {
      setIsSaving(false);
    }
  }

  function startEdit(comp: CompRow) {
    setEditingId(comp.id);
    setError("");
    setForm({
      source: comp.source,
      platform: comp.platform ?? "",
      status: comp.status,
      title: comp.title,
      brand: comp.brand ?? "",
      size: comp.size ?? "",
      price: (comp.priceCents / 100).toString(),
      shipping: comp.shippingCents ? (comp.shippingCents / 100).toString() : "",
      soldDate: comp.soldDate ? comp.soldDate.slice(0, 10) : "",
      url: comp.url ?? "",
      condition: comp.condition,
      notes: comp.notes ?? "",
    });
  }

  async function toggleField(comp: CompRow, field: "usedInPricing" | "ignoredAsOutlier") {
    setBusyId(comp.id);
    setError("");
    try {
      const response = await fetch(`/api/listings/comps/${comp.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ [field]: !comp[field] }),
      });
      const payload = (await response.json()) as CompsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not update the comp.");
      applyResponse(payload);
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Could not update the comp.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteComp(comp: CompRow) {
    setBusyId(comp.id);
    setError("");
    try {
      const response = await fetch(`/api/listings/comps/${comp.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const payload = (await response.json()) as CompsResponse & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Could not delete the comp.");
      applyResponse(payload);
      if (editingId === comp.id) resetForm();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete the comp.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {summary ? <PricingRecommendationCard summary={summary} /> : null}

      <form onSubmit={submitForm} className="border border-neutral-300 bg-white p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">{editingId ? "Edit comp" : "Add a manual comp"}</p>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-800"
            >
              <X className="h-3 w-3" /> Cancel edit
            </button>
          ) : null}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Source</span>
            <input
              required
              value={form.source}
              onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
              placeholder="eBay sold, StockX, Grailed sold"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Platform</span>
            <select
              value={form.platform}
              onChange={(e) => setForm((f) => ({ ...f, platform: e.target.value }))}
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            >
              {platformOptions.map((option) => (
                <option key={option || "none"} value={option}>
                  {option ? option : "—"}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Status</span>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as CompStatus }))}
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            >
              {statusOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Title</span>
            <input
              required
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="Comparable item title"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Brand</span>
            <input
              value={form.brand}
              onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
              placeholder="Nike"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Size</span>
            <input
              value={form.size}
              onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))}
              placeholder="10.5"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Sale price (USD)</span>
            <input
              required
              inputMode="decimal"
              value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              placeholder="225.00"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Shipping (USD)</span>
            <input
              inputMode="decimal"
              value={form.shipping}
              onChange={(e) => setForm((f) => ({ ...f, shipping: e.target.value }))}
              placeholder="0.00"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Sold date</span>
            <input
              type="date"
              value={form.soldDate}
              onChange={(e) => setForm((f) => ({ ...f, soldDate: e.target.value }))}
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Condition</span>
            <select
              value={form.condition}
              onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value }))}
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            >
              {conditionOptions.map((option) => (
                <option key={option} value={option}>
                  {option.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium">Listing URL</span>
            <input
              type="url"
              value={form.url}
              onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
              placeholder="https://"
              className="border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium">Notes</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder="Why this comp is comparable (size, condition, recency)."
              className="resize-y border border-neutral-300 px-3 py-2 outline-none focus:border-red-700"
            />
          </label>
        </div>
        <button
          type="submit"
          disabled={isSaving}
          className="mt-3 inline-flex h-10 items-center justify-center gap-2 bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {editingId ? "Save changes" : "Add comp"}
        </button>
        {error ? (
          <p className="mt-3 border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </p>
        ) : null}
      </form>

      {isLoading ? (
        <p className="border border-neutral-300 bg-white p-4 text-sm text-neutral-500">
          Loading comps…
        </p>
      ) : (
        <CompsTable
          comps={comps}
          onEdit={startEdit}
          onDelete={deleteComp}
          onToggle={toggleField}
          busyId={busyId}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/comps-panel.test.tsx`
Expected: PASS (5 assertions across the two describes).

---

## Task 7: Full verification gate + single commit + handoff

**Files:**
- Modify: `HANDOFF.md` (prepend a dated bullet; refresh Current state / Next up)

- [ ] **Step 1: Run the full project gate**

```bash
npm run lint
npx tsc --noEmit
npm test
npx prisma validate
npm run build
```

Expected: lint clean (the 2 pre-existing `_m`/`_f` warnings in `draft-actions.test.ts` are acceptable, but introduce **no new** warnings/errors); `tsc` clean; all vitest suites pass; schema valid; `next build` succeeds.

> If `npm run build` fails for lack of env/DB (it runs `prisma generate` then `next build`), capture the exact error. App routes here are `runtime = "nodejs"` and dynamic, so the build should not hit the DB. If it does fail on env, report it as a known gap rather than papering over it — do not stub or disable the failing route.

- [ ] **Step 2: Update `HANDOFF.md`**

Prepend under `## Last updated` (move the current entry to `## Previous update`) a dated bullet summarizing: PriceComp v2 (additive migration `20260613020000_price_comp_v2_fields`, median-anchored pricing with sold-preference + confidence reasons, comps `[compId]` PATCH/DELETE, upgraded comps panel, 5 env-gated provider stubs), tests green, **migration not yet applied to prod** (owner runs `npm run db:deploy` through develop→main), branch `feature/price-comp-v2` not pushed/merged pending approval.

- [ ] **Step 3: Single commit (after the gate passes)**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Upgrade PriceComp pricing comps architecture

PriceComp v2: additive migration (CompSourceType/CompStatus enums + status,
sourceType, platform, brand, size, currency, totalPriceCents, imageUrl,
matchScore, usedInPricing, ignoredAsOutlier, rawJson). Pricing module now
anchors on median, excludes usedInPricing=false/ignoredAsOutlier=true, prefers
sold comps when >=2 exist, and returns confidenceScore + confidenceReasons +
sold/active counts. New PATCH/DELETE comps API with seller-ownership checks.
Upgraded comps panel (platform/status selectors, edit, delete, use-in-pricing
and outlier toggles, median + counts + reasons). Five env-gated provider stubs
(Apify eBay sold, Grailed sold, Poshmark sold, Depop active, Google Lens).
Backward compatible: legacy manual comps still calculate.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Do NOT push or merge.** Report completion; the owner approves the push to `feature/price-comp-v2` and the develop→main flow, and applies the migration to prod.

---

## Self-Review (run before execution)

**Spec coverage (task → requirement):**
1. DB columns → Task 1 (all listed fields; `totalPriceCents` cents-deviation noted; `condition`/`soldDate` already present; FK + RLS untouched; no rename; no `listing_comps`). ✓
2. Pricing (exclusions, total precedence, low/median/avg/high, sold-preference ≥2, quick=median×0.9, list=median×1.1, confidenceScore + reasons, comp/sold/active counts, average kept) → Task 2. ✓
3. API (keep GET/POST/refresh, add update + delete, Zod, auth, ownership) → Tasks 3 & 4. ✓
4. UI (platform selector, status selector, edit, delete, use-in-pricing toggle, ignore-outlier toggle, median display, sold/active counts, confidence reasons, compact) → Task 6. ✓
5. Providers (keep CompSource + registry; add 5 env-gated stubs; no scraping/proxy/CAPTCHA; no Marketplace Insights) → Task 5. ✓
6. Backward compatibility (legacy `{source/price/shipping/url/title}` comps still calculate via optional fields + DB defaults; old average→median test updates allowed) → Tasks 2 & 1. ✓
7. Tests (migration/model, median, average present, sold-preferred, usedInPricing exclusion, ignoredAsOutlier exclusion, empty state, confidence reasons, PATCH auth, DELETE auth, UI status/toggles/recommendation) → Tasks 1,2,3,4,6. ✓
8. Commands (lint, tests, build — plus tsc + prisma validate per project gate) + commit message → Task 7. ✓

**Type consistency:** `Summary`/`CompRow` (panel) mirror `PricingSummary` (module) and the PriceComp row shape; `summarizeComps` maps DB rows → `PricingComp`; `CompStatus`/`CompSourceType` enum string values are identical across Prisma, Zod, and TS unions; `toUpdateData` keys match `UpdatePriceCompSchema`. ✓

**Placeholder scan:** No TBD/TODO-in-plan; every code step is complete. (The provider stub bodies legitimately contain `// TODO` comments — that is the intended stub state, not a plan placeholder.) ✓

**Known gaps (report these):**
- Real provider fetching is not implemented (stubs return `[]` by design).
- Migration is authored but NOT applied to any DB (owner runs `npm run db:deploy` via develop→main).
- Confidence recency uses wall-clock `new Date()`; deterministic in tests via today's date / a 2020 date.
- `totalPrice` stored as `totalPriceCents Int?` (cents) instead of decimal, to match the codebase's money convention.
- `npm run build` env-dependence: if it needs DB/env in this environment, that is environmental, not a code defect.
