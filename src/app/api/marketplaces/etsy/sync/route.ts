import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getActiveAccount } from "@/lib/billing/account";
import { getPrisma } from "@/lib/prisma";
import { isEtsyApiEnabled } from "@/lib/marketplace/adapters/etsy/config";
import {
  EtsyIntegrationError,
  etsyErrorCodes,
  toEtsyErrorPayload,
} from "@/lib/marketplace/adapters/etsy/errors";
import { getEtsyAuthorizedSession } from "@/lib/marketplace/adapters/etsy/session";
import { syncEtsyListing } from "@/lib/marketplace/adapters/etsy/sync";
import { ETSY_ENVIRONMENT } from "@/lib/marketplace/adapters/etsy/types";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

const BodySchema = z.object({ itemId: z.string().uuid() }).strict();

// Read-only status sync for a connected seller. Gated on the global switch and a
// real connection (via the authorized session); it changes no Etsy state.
export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    if (!isEtsyApiEnabled()) {
      throw new EtsyIntegrationError(
        etsyErrorCodes.notEnabled,
        "Etsy API integration is not enabled.",
        503,
      );
    }

    const body = BodySchema.parse(await request.json());
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    const item = await prisma.inventoryItem.findFirst({
      where: { id: body.itemId, accountId: account.id },
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
      return NextResponse.json({ synced: false, reason: "no_listing" });
    }

    const session = await getEtsyAuthorizedSession({ userId: user.id, accountId: account.id });
    const result = await syncEtsyListing({
      client: session.client,
      listingId: listing.externalListingId,
    });

    await prisma.marketplaceListing.update({
      where: { id: listing.id },
      data: { status: result.status, lastSyncAt: new Date(), lastError: null },
    });

    return NextResponse.json({ synced: true, status: result.status, state: result.state });
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("ETSY_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }
    const { payload, status } = toEtsyErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}
