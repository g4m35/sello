-- Append-only ledger of paid comp-provider calls for cost/quota accounting and a
-- seller-scoped admin/log view. Additive only; no existing rows change. The table
-- is intentionally NOT cascaded from drafts/items so cost history survives their
-- deletion.

CREATE TYPE "ProviderCallStatus" AS ENUM ('attempted', 'succeeded', 'failed', 'skipped');

CREATE TABLE "ProviderCallLedger" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "draftId" UUID,
  "inventoryItemId" UUID,
  "provider" TEXT NOT NULL,
  "status" "ProviderCallStatus" NOT NULL,
  "skippedReason" TEXT,
  "estimatedCostCents" INTEGER NOT NULL DEFAULT 0,
  "fetchedCount" INTEGER NOT NULL DEFAULT 0,
  "acceptedCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedCount" INTEGER NOT NULL DEFAULT 0,
  "queryHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProviderCallLedger_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProviderCallLedger_userId_createdAt_idx"
  ON "ProviderCallLedger"("userId", "createdAt");
CREATE INDEX "ProviderCallLedger_createdAt_idx"
  ON "ProviderCallLedger"("createdAt");
CREATE INDEX "ProviderCallLedger_draftId_createdAt_idx"
  ON "ProviderCallLedger"("draftId", "createdAt");

-- Defense-in-depth: app access is via the resale_app role (bypasses RLS); the
-- browser never queries this table directly. Enabling RLS with no policy denies
-- the authenticated/anon roles by default, so a row can never leak cross-user
-- even if a client query were ever introduced.
ALTER TABLE "ProviderCallLedger" ENABLE ROW LEVEL SECURITY;
