-- Alpha-user feedback. Additive only. Seller-scoped reads (own rows); admins (env
-- allowlist) read/triage all. Not cascaded so feedback survives the referenced
-- listing/draft. RLS enabled as defense-in-depth.

CREATE TYPE "FeedbackType" AS ENUM ('bug', 'feature_request', 'confusion', 'pricing_issue', 'marketplace_issue', 'other');
CREATE TYPE "FeedbackSeverity" AS ENUM ('low', 'medium', 'high');
CREATE TYPE "FeedbackStatus" AS ENUM ('open', 'reviewing', 'resolved', 'dismissed');

CREATE TABLE "Feedback" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL,
  "type" "FeedbackType" NOT NULL,
  "severity" "FeedbackSeverity" NOT NULL DEFAULT 'medium',
  "marketplace" TEXT,
  "subject" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "pageUrl" TEXT,
  "listingId" UUID,
  "draftId" UUID,
  "status" "FeedbackStatus" NOT NULL DEFAULT 'open',
  "adminNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Feedback_status_createdAt_idx" ON "Feedback"("status", "createdAt");
CREATE INDEX "Feedback_userId_createdAt_idx" ON "Feedback"("userId", "createdAt");

ALTER TABLE "Feedback" ENABLE ROW LEVEL SECURITY;
