import { StandingAuthorizationSchema, type StandingAuthorization } from "./settings-schema";
import { assertStandingAuthorization } from "./settings";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { getPrisma } from "@/lib/prisma";
import { resolveRuntimeEntitlements } from "@/lib/auth/feature-access";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import { runCompFetch } from "@/lib/comps/fetch";
import { publishForUser } from "@/lib/marketplace/publish-service";
import { AppError, logUnexpectedError } from "@/lib/errors";
import { automaticPriceDecision, hasSingleEbayQuantity, ListingAutomationSchema } from "./policy";
import { createListingAutomationReview } from "./review";

export const LISTING_QUEUE = "listing-automation-v1";
export const JobPayloadSchema = z.object({
  version: z.literal(1), accountId: z.string(), userId: z.string(),
  policy: ListingAutomationSchema, authorizedAt: z.string().datetime(),
  warnings: z.array(z.string()), standingAuthorization: StandingAuthorizationSchema.optional(),
}).strict();
type Db = ReturnType<typeof getPrisma>;

export const listingJobDeps = {
  resolveUser: async (id: string) => {
    const { data, error } = await createSupabaseServiceClient().auth.admin.getUserById(id);
    if (error || !data.user) throw new AppError("Sign in again to continue.", 401);
    return data.user;
  },
  entitlements: resolveRuntimeEntitlements,
  fetchComps: runCompFetch,
  publish: publishForUser,
};

// A job is claimed once. An interrupted RUNNING job is never replayed blindly:
// it may already have paid a provider or created a marketplace listing.
export async function runListingJob(id: string, db: Db = getPrisma(), deps = listingJobDeps) {
  const job = await db.jobLog.findFirst({ where: { id, queueName: LISTING_QUEUE, status: "QUEUED" } });
  if (!job?.inventoryItemId) return;
  const claimed = await db.jobLog.updateMany({ where: { id, status: "QUEUED", updatedAt: job.updatedAt }, data: { status: "RUNNING" } });
  if (claimed.count !== 1) return;
  let canRetryPreparation = false;
  let publishStarted = false;
  let blocker: "identification_review" | null = null;
  const checkpoint = async (message: string) => {
    const result = await db.jobLog.updateMany({ where: { id, status: "RUNNING" }, data: { result: { message } } });
    if (result.count !== 1) throw new AppError("Automation was stopped. Review the listing.", 409);
  };
  const finish = async (state: "prepared" | "published" | "needs_review", message: string) => {
    await db.$transaction(async (tx) => {
      const updated = await tx.jobLog.updateMany({ where: { id, status: "RUNNING" }, data: {
        status: state === "needs_review" ? "FAILED" : "SUCCEEDED", result: { state, message, blocker,
          phase: publishStarted ? "publishing" : "preparing",
          recoveryAction: state === "needs_review" && canRetryPreparation && !publishStarted ? "retry_preparation" : null },
        errorMessage: state === "needs_review" ? message : null,
      } });
      if (updated.count === 1 && state === "needs_review") await createListingAutomationReview(tx, job, message);
    });
  };
  try {
    const payload = JobPayloadSchema.parse(job.payload);
    canRetryPreparation = true;
    if (!payload.standingAuthorization && Date.now() - new Date(payload.authorizedAt).getTime() > 24 * 60 * 60_000) throw new AppError("This authorization expired. Review the listing before posting.", 409);
    const user = await deps.resolveUser(payload.userId);
    const access = await deps.entitlements(user, db);
    if (user.id !== payload.userId || access.account.id !== payload.accountId) throw new AppError("Account access changed. Review this listing.", 403);
    const load = () => db.inventoryItem.findFirst({
      where: { id: job.inventoryItemId!, accountId: payload.accountId },
      include: { listingDrafts: { orderBy: { updatedAt: "desc" as const }, take: 1 } },
    });
    const item = await load();
    const draft = item?.listingDrafts[0];
    if (!item || !draft || item.status !== "DRAFT_READY" || item.quantityAvailable !== 1) throw new AppError("This listing needs review before automation can continue.", 409);
    if (payload.policy.mode === "publish" && !hasSingleEbayQuantity(draft.marketplaceDrafts)) return await finish("needs_review", "eBay quantity must match the single item in inventory.");
    if (item.confidence == null || item.confidence < 0.9 || payload.warnings.length) {
      canRetryPreparation = false;
      blocker = "identification_review";
      return await finish("needs_review", "Confirm the identified item and its details.");
    }
    if (payload.standingAuthorization) await assertStandingAuthorization(db, payload.accountId, payload.standingAuthorization);
    await checkpoint("Finding comparable sold listings…");
    const comps = await deps.fetchComps(db, item.id, user.id, {
      accountId: payload.accountId, paidProvidersAllowed: access.access.paidComps,
      idempotencyKey: `${id}:comps`, applyPrice: false,
    });
    const reason = automaticPriceDecision({ confidence: item.confidence, warnings: payload.warnings,
      price: comps.summary.recommendedListCents, pricingConfidence: comps.summary.confidence,
      soldCompCount: comps.summary.soldCompCount, pricingBasis: comps.summary.pricingBasis, policy: payload.policy });
    if (reason) return await finish("needs_review", reason);
    const price = comps.summary.recommendedListCents!;
    // Both writes roll back if a seller edited the item during provider work.
    const priced = await db.$transaction(async (tx) => {
      const updatedItem = await tx.inventoryItem.updateMany({
        where: { id: item.id, accountId: payload.accountId, updatedAt: item.updatedAt, status: "DRAFT_READY", quantityAvailable: 1 },
        data: { recommendedPriceCents: price },
      });
      const updatedDraft = await tx.listingDraft.updateMany({ where: { id: draft.id, updatedAt: draft.updatedAt }, data: { recommendedPriceCents: price } });
      if (updatedItem.count !== 1 || updatedDraft.count !== 1) throw new AppError("You changed this listing while it was being prepared. Review it before posting.", 409);
      return tx.inventoryItem.findFirst({ where: { id: item.id, accountId: payload.accountId }, include: { listingDrafts: { orderBy: { updatedAt: "desc" }, take: 1 } } });
    });
    if (payload.policy.mode === "prepare") return await finish("prepared", "Listing and price prepared. Review it and choose where to post.");
    await checkpoint("Checking requirements and posting to eBay…");
    if (!priced?.listingDrafts[0]) throw new AppError("Listing not found.", 404);
    // Persist the boundary before invoking the external action. An interrupted
    // publish is never eligible for preparation recovery or renewed consent.
    if (payload.standingAuthorization) {
      await assertStandingAuthorization(db, payload.accountId, payload.standingAuthorization);
      const currentAccess = await deps.entitlements(user, db);
      if (currentAccess.account.id !== payload.accountId) throw new AppError("Account access changed. Review this listing.", 403);
    }
    publishStarted = true;
    const boundary = await db.jobLog.updateMany({ where: { id, status: "RUNNING" }, data: {
      result: { phase: "publishing", message: "Checking requirements and posting to eBay…", recoveryAction: null },
    } });
    if (boundary.count !== 1) throw new AppError("Automation was stopped. Review the listing.", 409);
    const result = await deps.publish(user, { inventoryItemId: item.id, marketplace: "ebay" }, `${id}:publish:ebay`, payload.accountId, {
      itemVersion: priced.updatedAt.toISOString(), draftVersion: priced.listingDrafts[0].updatedAt.toISOString(), priceCents: price, ...(payload.standingAuthorization ? { standingAuthorization: payload.standingAuthorization } : {}),
    });
    if (result.outcome.status === "published") return await finish("published", "Published to eBay. The marketplace result is recorded in activity.");
    return await finish("needs_review", "eBay did not confirm a published listing. Review marketplace activity before retrying.");
  } catch (error) {
    logUnexpectedError("listing_automation", error);
    await finish("needs_review", error instanceof AppError ? error.message : "Automatic preparation stopped. Review this listing before retrying.");
  }
}

export async function runListingQueue(db: Db = getPrisma(), deadline = Date.now() + 180_000) {
  // Interrupted calls need reconciliation, never a second blind publish.
  const stale = await db.jobLog.findMany({ where: { queueName: LISTING_QUEUE, status: "RUNNING", updatedAt: { lt: new Date(Date.now() - 15 * 60_000) } }, take: 10, orderBy: { updatedAt: "asc" } });
  for (const job of stale) {
    const message = "Automation was interrupted. Check marketplace activity before retrying.";
    await db.$transaction(async (tx) => {
      const updated = await tx.jobLog.updateMany({ where: { id: job.id, status: "RUNNING", updatedAt: job.updatedAt }, data: {
        status: "FAILED", errorMessage: message, result: { state: "needs_review", message },
      } });
      if (updated.count === 1) await createListingAutomationReview(tx, job, message);
    });
  }
  const jobs = await db.jobLog.findMany({ where: { queueName: LISTING_QUEUE, status: "QUEUED" }, orderBy: { createdAt: "asc" }, take: 10, select: { id: true } });
  let processed = 0;
  for (const job of jobs) {
    if (Date.now() >= deadline) break;
    await runListingJob(job.id, db);
    processed++;
  }
  return processed;
}

export function automationJobData(input: { id: string; inventoryItemId: string; accountId: string; userId: string; policy: z.infer<typeof ListingAutomationSchema>; warnings: string[]; standingAuthorization?: StandingAuthorization }) {
  const { id, inventoryItemId, ...payload } = input;
  return { id, inventoryItemId, queueName: LISTING_QUEUE, jobName: "prepare-and-publish", status: "QUEUED" as const,
    payload: { version: 1, authorizedAt: new Date().toISOString(), ...payload } as Prisma.InputJsonValue,
    result: { message: "Listing created. Preparing pricing…" } };
}
