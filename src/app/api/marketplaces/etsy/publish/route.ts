import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, getErrorMessage, logUnexpectedError } from "@/lib/errors";
import { getActiveAccount } from "@/lib/billing/account";
import { reserveUsageOrThrow, markUsageWorkStarted, releaseUsageReservation, markUsageReconciliationRequired, settleUsageReservationOrRequireReconciliation } from "@/lib/billing/usage";
import { syncMasterStatusAfterMarketplacePublish } from "@/lib/marketplace/lifecycle-sync";
import { createReviewTask } from "@/lib/inventory/review-tasks";
import { getPrisma } from "@/lib/prisma";
import { requireEtsyCapability } from "@/lib/marketplace/adapters/etsy/capabilities";
import {
  EtsyIntegrationError,
  etsyErrorCodes,
  toEtsyErrorPayload,
} from "@/lib/marketplace/adapters/etsy/errors";
import { buildEtsyDraftBody } from "@/lib/marketplace/adapters/etsy/mapper";
import { loadEtsyImagesForItem } from "@/lib/marketplace/adapters/etsy/media";
import { publishEtsyListing } from "@/lib/marketplace/adapters/etsy/publish";
import { evaluateEtsyReadiness } from "@/lib/marketplace/adapters/etsy/readiness";
import { getEtsyAuthorizedSession } from "@/lib/marketplace/adapters/etsy/session";
import { ETSY_ENVIRONMENT } from "@/lib/marketplace/adapters/etsy/types";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

const idSchema = z.union([z.number(), z.string()]).nullish();
const BodySchema = z
  .object({
    itemId: z.string().uuid(),
    confirm: z.boolean(),
    activate: z.boolean().optional().default(false),
    // Seller-provided Etsy specifics Sello cannot infer.
    taxonomyId: idSchema,
    shippingProfileId: idSchema,
    readinessStateId: idSchema,
    returnPolicyId: idSchema,
    whoMade: z.string().min(1),
    whenMade: z.string().min(1),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    // Fail closed: live publish requires the global switch + publish allowlist.
    requireEtsyCapability(user, "publish");

    const body = BodySchema.parse(await request.json());
    if (!body.confirm) {
      throw new EtsyIntegrationError(
        etsyErrorCodes.confirmationRequired,
        "Confirm before publishing to Etsy.",
        400,
      );
    }

    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    const item = await prisma.inventoryItem.findFirst({
      where: { id: body.itemId, accountId: account.id },
      include: {
        listingDrafts: { orderBy: { updatedAt: "desc" }, take: 1 },
        photos: true,
      },
    });
    if (!item) {
      throw new AppError("Item not found", 404);
    }
    if (["SOLD", "ARCHIVED", "DELISTING"].includes(item.status) || item.soldAt || item.soldSourceMarketplace || item.quantityAvailable < 1) {
      throw new AppError("Sold, archived, or unavailable inventory cannot be published.", 409);
    }
    const draft = item.listingDrafts[0] ?? null;

    const connection = await prisma.marketplaceConnection.findUnique({
      where: {
        accountId_marketplace_environment: {
          accountId: account.id,
          marketplace: "etsy",
          environment: ETSY_ENVIRONMENT,
        },
      },
    });

    const title = draft?.title ?? item.productName;
    const description = draft?.description ?? "";
    const priceCents = draft?.recommendedPriceCents ?? item.recommendedPriceCents ?? null;
    const quantity = item.quantityAvailable;

    const readiness = evaluateEtsyReadiness({
      apiEnabled: true,
      connected: Boolean(connection),
      reconnectRequired: false,
      title,
      description,
      priceCents,
      quantity,
      photoCount: item.photos.length,
      taxonomyId: body.taxonomyId ?? null,
      readinessStateId: body.readinessStateId ?? null,
      shippingProfileId: body.shippingProfileId ?? null,
      returnPolicyId: body.returnPolicyId ?? null,
    });
    if (!readiness.ready) {
      // Not an error: the seller can still use the copy-ready draft.
      return NextResponse.json(
        { ready: false, missing: readiness.missing, copyReadyAvailable: true },
        { status: 422 },
      );
    }

    // Idempotency: never create a second Etsy listing for an item already live.
    const existing = await prisma.marketplaceListing.findUnique({
      where: {
        inventoryItemId_marketplace_environment: {
          inventoryItemId: item.id,
          marketplace: "etsy",
          environment: ETSY_ENVIRONMENT,
        },
      },
    });
    if (
      existing?.externalListingId &&
      existing.status === "LISTED"
    ) {
      return NextResponse.json({
        skipped: true,
        code: etsyErrorCodes.alreadyPublished,
        listingId: existing.externalListingId,
        status: existing.status,
      });
    }

    const session = await getEtsyAuthorizedSession({ userId: user.id, accountId: account.id });
    const listingBody = buildEtsyDraftBody({
      title,
      description,
      priceCents: priceCents as number,
      quantity,
      taxonomyId: body.taxonomyId as number | string,
      readinessStateId: body.readinessStateId ?? null,
      shippingProfileId: body.shippingProfileId as number | string,
      returnPolicyId: body.returnPolicyId ?? null,
      whoMade: body.whoMade,
      whenMade: body.whenMade,
      tags: etsyTagsFromDraft(draft?.marketplaceDrafts),
    });
    const images = await loadEtsyImagesForItem(item.photos);

    if (images.length !== item.photos.length) {
      throw new EtsyIntegrationError(etsyErrorCodes.imageUploadFailed, "Some photos could not be loaded. Retry before publishing to Etsy.", 422);
    }
    const listing = existing ?? await prisma.marketplaceListing.upsert({
      where: { inventoryItemId_marketplace_environment: { inventoryItemId: item.id, marketplace: "etsy", environment: ETSY_ENVIRONMENT } },
      create: { inventoryItemId: item.id, marketplace: "etsy", environment: ETSY_ENVIRONMENT, status: "NOT_LISTED" },
      update: {},
    });
    // An attempt without an ID may have reached Etsy before its response was
    // lost. Never turn that uncertainty into another create request.
    if (!["NOT_LISTED", "FAILED", "NEEDS_REVIEW"].includes(listing.status) || (!listing.externalListingId && listing.status !== "NOT_LISTED")) {
      throw new EtsyIntegrationError(etsyErrorCodes.publishFailed, "This Etsy attempt is in progress or needs review. Sync the existing listing before retrying.", 409);
    }
    const photoSnapshot = (photos: typeof item.photos) => JSON.stringify(photos.map(({ id, position, storageBucket, storagePath }) => ({ id, position, storageBucket, storagePath })).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)));
    const snapshotHash = createHash("sha256").update(JSON.stringify({ listingBody, photos: photoSnapshot(item.photos) })).digest("hex");
    const metadata = listing.metadata && typeof listing.metadata === "object" && !Array.isArray(listing.metadata) ? listing.metadata : {};
    if (listing.externalListingId && metadata.etsyPublishSnapshotHash !== snapshotHash) {
      throw new EtsyIntegrationError(etsyErrorCodes.publishFailed, "This saved Etsy draft differs from the current listing. Review it in Etsy before retrying.", 409);
    }
    // Read the durable billing lifecycle, including crashes between settlement
    // and the final listing write. A local flag cannot prove a unit is held.
    const previousUsageKey = typeof metadata.etsyPublishUsageKey === "string" ? metadata.etsyPublishUsageKey : null;
    const previousUsage = previousUsageKey ? await prisma.usageReservation.findUnique({
      where: { accountId_metric_idempotencyKey: { accountId: account.id, metric: "autopublish", idempotencyKey: previousUsageKey } },
      select: { status: true, operationId: true },
    }) : null;
    if (previousUsage && previousUsage.operationId !== `${item.id}:etsy`) throw new AppError("Etsy usage belongs to a different operation.", 409);
    const reuseUsage = previousUsage?.status === "reserved" || previousUsage?.status === "settled";
    if (listing.externalListingId && !reuseUsage) {
      const remote = await session.client.getListing(listing.externalListingId);
      if (String(remote.listing_id) !== listing.externalListingId || remote.state !== "draft") {
        throw new EtsyIntegrationError(etsyErrorCodes.publishFailed, "Verify the saved Etsy listing and its usage before retrying.", 409);
      }
    }
    const usageKey = reuseUsage && previousUsageKey ? previousUsageKey : randomUUID();
    const claim = await prisma.marketplaceListing.updateMany({
      where: { id: listing.id, status: listing.status, updatedAt: listing.updatedAt,
        inventoryItem: { accountId: account.id, status: { notIn: ["SOLD", "ARCHIVED", "DELISTING"] }, quantityAvailable: { gt: 0 }, soldAt: null, soldSourceMarketplace: null } },
      data: { status: "LISTING", lastError: null, metadata: { ...metadata, etsyPublishSnapshotHash: snapshotHash, etsyPublishUsageKey: usageKey } },
    });
    if (claim.count !== 1) throw new EtsyIntegrationError(etsyErrorCodes.publishFailed, "Inventory or the Etsy attempt changed. Refresh before retrying.", 409);
    let reservationId: string | null = null;
    let externalStarted = false;
    let knownListingId = listing.externalListingId;
    let result: Awaited<ReturnType<typeof publishEtsyListing>>;
    try {
      const reservation = await reserveUsageOrThrow({ accountId: account.id, metric: "autopublish", idempotencyKey: usageKey, now: new Date(), operationType: "marketplace_publish", operationId: `${item.id}:etsy`, user }, prisma);
      reservationId = reservation.reservationId;
      if (reservation.status !== "settled" && !await markUsageWorkStarted(reservationId, new Date(), prisma)) throw new AppError("The publish reservation is no longer active.", 409);
      externalStarted = true;
      result = await publishEtsyListing({
        client: session.client, shopId: session.shopId, listingBody, images, activate: body.activate,
        existingListingId: knownListingId,
        requireExistingActive: reservation.status === "settled",
        persistDraft: async (listingId) => {
          await prisma.marketplaceListing.update({ where: { id: listing.id }, data: { externalListingId: String(listingId), externalUrl: `https://www.etsy.com/listing/${listingId}` } });
          knownListingId = String(listingId);
        },
        assertCanActivate: async () => {
          const unsold = await prisma.inventoryItem.findFirst({ where: { id: item.id, accountId: account.id, status: { notIn: ["SOLD", "ARCHIVED", "DELISTING"] }, quantityAvailable: quantity, soldAt: null, soldSourceMarketplace: null, updatedAt: item.updatedAt, } , include: { photos: true, listingDrafts: { orderBy: { updatedAt: "desc" }, take: 1 } } });
          const latestDraft = unsold?.listingDrafts[0] ?? null;
          if (!unsold || photoSnapshot(unsold.photos) !== photoSnapshot(item.photos) || latestDraft?.id !== draft?.id || latestDraft?.updatedAt.getTime() !== draft?.updatedAt.getTime()) throw new AppError("Inventory changed. The Etsy draft was saved but cannot be activated.", 409);
        },
      });

      if (result.state === "active") {
        await settleUsageReservationOrRequireReconciliation(reservationId, new Date(), "ETSY_PUBLISH_SETTLEMENT_FAILED", prisma);
      } else {
        await releaseUsageReservation(reservationId, new Date(), prisma, "released", { allowStartedWork: true });
      }
      const saved = await prisma.marketplaceListing.updateMany({
        where: { id: listing.id, status: "LISTING", inventoryItem: { accountId: account.id, status: { notIn: ["SOLD", "ARCHIVED", "DELISTING"] }, soldAt: null, soldSourceMarketplace: null } },
        data: { status: result.state === "active" ? "LISTED" : "NOT_LISTED", lastSyncAt: new Date(), lastError: null, metadata: { ...metadata, etsyPublishSnapshotHash: snapshotHash, etsyPublishUsageKey: usageKey } },
      });
      if (saved.count !== 1) throw new AppError("Inventory changed during publishing. Review the saved Etsy listing and its removal task.", 409);
      await prisma.reviewTask.updateMany({ where: { accountId: account.id, dedupeKey: `etsy-publish:${listing.id}`, status: "open" }, data: { status: "resolved", resolvedAt: new Date() } });
      await prisma.marketplaceEvent.create({ data: { marketplaceListingId: listing.id, kind: "etsy_publish_confirmed", data: { state: result.state, listingId: result.listingId } } });
      if (result.state === "active") await syncMasterStatusAfterMarketplacePublish(prisma, item.id);
    } catch (error) {
      // A crash leaves LISTING in place; a caught ambiguous create becomes
      // NEEDS_REVIEW. Neither path is eligible for another create.
      await prisma.marketplaceListing.updateMany({
        where: { id: listing.id, status: "LISTING" },
        data: { status: !externalStarted ? listing.status : "NEEDS_REVIEW", ...(!externalStarted ? { metadata } : {}), lastError: knownListingId ? "Etsy publish incomplete. Retry using the saved listing." : "Etsy publish outcome unknown. Review Etsy before any new attempt." },
      }).catch((persistenceError) => logUnexpectedError("etsy_publish_claim", persistenceError));
      if (externalStarted) {
        await createReviewTask(prisma, { userId: user.id, accountId: account.id, inventoryItemId: item.id, marketplace: "etsy", type: "sync_conflict", dedupeKey: `etsy-publish:${listing.id}`, title: "Review incomplete Etsy publish", description: knownListingId ? "Etsy may have changed this saved listing. Check its status before retrying." : "Etsy may have created a draft without returning its ID. Check your shop before creating another listing.", payload: { reason: "etsy_publish_incomplete", marketplaceListingId: listing.id, externalListingId: knownListingId } }).catch((reviewError) => logUnexpectedError("etsy_publish_review", reviewError));
      }
      if (reservationId) {
        const cleanup = externalStarted
          ? markUsageReconciliationRequired(reservationId, new Date(), "ETSY_PUBLISH_OUTCOME_UNKNOWN", prisma)
          : releaseUsageReservation(reservationId, new Date(), prisma, "released", { allowStartedWork: true });
        await cleanup.catch((usageError) => logUnexpectedError("etsy_publish_usage", usageError));
      }
      throw error;
    }
    const status = result.state === "active" ? "LISTED" : "NOT_LISTED";

    return NextResponse.json({
      ok: true,
      listingId: result.listingId,
      state: result.state,
      status,
      listingUrl: `https://www.etsy.com/listing/${result.listingId}`,
      images: result.images,
    });
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("ETSY_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }
    const { payload, status } = toEtsyErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}

function etsyTagsFromDraft(marketplaceDrafts: unknown): string[] {
  if (!marketplaceDrafts || typeof marketplaceDrafts !== "object") return [];
  const etsy = (marketplaceDrafts as Record<string, unknown>).etsy;
  if (!etsy || typeof etsy !== "object") return [];
  const tags = (etsy as Record<string, unknown>).tags;
  return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === "string") : [];
}
