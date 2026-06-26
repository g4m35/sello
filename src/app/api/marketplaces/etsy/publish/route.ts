import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getActiveAccount } from "@/lib/billing/account";
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
    const quantity = 1;

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
      (existing.status === "LISTED" || existing.status === "LISTING")
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
      shippingProfileId: body.shippingProfileId as number | string,
      returnPolicyId: body.returnPolicyId ?? null,
      whoMade: body.whoMade,
      whenMade: body.whenMade,
      tags: etsyTagsFromDraft(draft?.marketplaceDrafts),
    });
    const images = await loadEtsyImagesForItem(item.photos);

    const result = await publishEtsyListing({
      client: session.client,
      shopId: session.shopId,
      listingBody,
      images,
      activate: body.activate,
    });

    const status = result.state === "active" ? "LISTED" : "NOT_LISTED";
    await prisma.marketplaceListing.upsert({
      where: {
        inventoryItemId_marketplace_environment: {
          inventoryItemId: item.id,
          marketplace: "etsy",
          environment: ETSY_ENVIRONMENT,
        },
      },
      create: {
        inventoryItemId: item.id,
        marketplace: "etsy",
        environment: ETSY_ENVIRONMENT,
        status,
        externalListingId: String(result.listingId),
        lastSyncAt: new Date(),
        lastError: null,
      },
      update: {
        status,
        externalListingId: String(result.listingId),
        lastSyncAt: new Date(),
        lastError: null,
      },
    });

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
