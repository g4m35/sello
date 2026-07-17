import { NextResponse } from "next/server";
import { z } from "zod";

import type { MarketplaceListingStatus, Prisma } from "@/generated/prisma/client";
import { getActiveAccount } from "@/lib/billing/account";
import { accountScope } from "@/lib/billing/scope";
import { AppError, safeErrorResponse } from "@/lib/errors";
import { recordInventoryEvent } from "@/lib/inventory/events";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Manual "add a marketplace URL" action. The seller tells us where their item is
// also listed (e.g. a Depop/Poshmark link) so the safety engine can later delist
// it. We verify the item is owned by the signed-in seller, upsert the
// MarketplaceListing on its (inventoryItemId, marketplace, environment) unique
// key, and record a listing_created audit event. No live marketplace/network
// call happens here — this only records the seller-provided URL.

const LISTING_ENVIRONMENT = "production";

const BodySchema = z
  .object({
    inventoryItemId: z.string().uuid(),
    marketplace: z.enum([
      "ebay",
      "grailed",
      "poshmark",
      "depop",
      "mercari",
      "etsy",
      "tiktok_shop",
      "vinted",
      "stockx",
    ]),
    externalUrl: z.string().url(),
    status: z
      .enum([
        "NOT_LISTED",
        "QUEUED",
        "LISTING",
        "LISTED",
        "SOLD",
        "DELISTING",
        "DELISTED",
        "FAILED",
        "ENDED",
        "UNKNOWN",
        "NEEDS_REVIEW",
        "SUBMITTED_FOR_AUDIT",
        "REJECTED",
      ])
      .optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUserFromRequestOrCookies(request);
    const body = BodySchema.parse(await request.json());
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);

    // Ownership: never attach a listing to another seller's item.
    const item = await prisma.inventoryItem.findFirst({
      where: { id: body.inventoryItemId, ...accountScope(account) },
      select: { id: true, accountId: true },
    });
    if (!item) {
      throw new AppError("Inventory item not found.", 404);
    }

    const status: MarketplaceListingStatus = body.status ?? "UNKNOWN";

    const listing = await prisma.marketplaceListing.upsert({
      where: {
        inventoryItemId_marketplace_environment: {
          inventoryItemId: item.id,
          marketplace: body.marketplace,
          environment: LISTING_ENVIRONMENT,
        },
      },
      create: {
        inventoryItemId: item.id,
        marketplace: body.marketplace,
        environment: LISTING_ENVIRONMENT,
        status,
        externalUrl: body.externalUrl,
      },
      update: {
        externalUrl: body.externalUrl,
        status,
      },
      select: { id: true, status: true, externalUrl: true },
    });

    await recordInventoryEvent(prisma, {
      inventoryItemId: item.id,
      userId: user.id,
      accountId: item.accountId,
      type: "listing_created",
      source: "manual",
      marketplace: body.marketplace,
      payload: {
        marketplaceListingId: listing.id,
        marketplace: body.marketplace,
        environment: LISTING_ENVIRONMENT,
        externalUrl: body.externalUrl,
        status,
      } as Prisma.InputJsonValue,
    });

    return NextResponse.json({ ok: true, listing });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "inventory_listings_create",
      fallbackCode: "LISTING_CREATE_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
