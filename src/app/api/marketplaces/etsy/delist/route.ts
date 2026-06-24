import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireEtsyCapability } from "@/lib/marketplace/adapters/etsy/capabilities";
import { deactivateEtsyListing } from "@/lib/marketplace/adapters/etsy/delist";
import {
  EtsyIntegrationError,
  etsyErrorCodes,
  toEtsyErrorPayload,
} from "@/lib/marketplace/adapters/etsy/errors";
import { getEtsyAuthorizedSession } from "@/lib/marketplace/adapters/etsy/session";
import { ETSY_ENVIRONMENT } from "@/lib/marketplace/adapters/etsy/types";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

const BodySchema = z.object({ itemId: z.string().uuid(), confirm: z.boolean() }).strict();

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    requireEtsyCapability(user, "delist");

    const body = BodySchema.parse(await request.json());
    if (!body.confirm) {
      throw new EtsyIntegrationError(
        etsyErrorCodes.confirmationRequired,
        "Confirm before ending the Etsy listing.",
        400,
      );
    }

    const prisma = getPrisma();
    const item = await prisma.inventoryItem.findFirst({
      where: { id: body.itemId, sellerId: user.id },
      select: { id: true },
    });
    if (!item) {
      throw new AppError("Item not found", 404);
    }

    const listing = await prisma.marketplaceListing.findUnique({
      where: {
        inventoryItemId_marketplace_environment: {
          inventoryItemId: item.id,
          marketplace: "etsy",
          environment: ETSY_ENVIRONMENT,
        },
      },
    });

    if (!listing?.externalListingId) {
      // Nothing live on Etsy for this item; ending is a safe no-op.
      return NextResponse.json({ skipped: true, reason: "no_active_listing" });
    }
    if (listing.status === "DELISTED") {
      return NextResponse.json({ skipped: true, reason: "already_ended" });
    }

    const session = await getEtsyAuthorizedSession({ userId: user.id });
    const result = await deactivateEtsyListing({
      client: session.client,
      shopId: session.shopId,
      listingId: listing.externalListingId,
    });

    await prisma.marketplaceListing.update({
      where: { id: listing.id },
      data: { status: "DELISTED", lastSyncAt: new Date(), lastError: null },
    });

    return NextResponse.json({ ok: true, listingId: result.listingId, state: result.state });
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("ETSY_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }
    const { payload, status } = toEtsyErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}
