import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getActiveAccount } from "@/lib/billing/account";
import { getPrisma } from "@/lib/prisma";
import { requireEtsyCapability } from "@/lib/marketplace/adapters/etsy/capabilities";
import { executeEtsyWorkerDelist } from "@/lib/inventory-sync/jobs/etsy-delist";
import { syncMasterStatusAfterMarketplaceDelist } from "@/lib/marketplace/lifecycle-sync";
import {
  EtsyIntegrationError,
  etsyErrorCodes,
  toEtsyErrorPayload,
} from "@/lib/marketplace/adapters/etsy/errors";
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
      // Nothing live on Etsy for this item; ending is a safe no-op.
      return NextResponse.json({ skipped: true, reason: "no_active_listing" });
    }
    if (["SOLD", "DELISTED", "ENDED"].includes(listing.status)) {
      return NextResponse.json({ skipped: true, reason: "already_ended" });
    }

    const result = await executeEtsyWorkerDelist({
      userId: user.id, accountId: account.id, inventoryItemId: item.id, marketplaceListingId: listing.id,
    }, prisma);
    if (result.changed) await syncMasterStatusAfterMarketplaceDelist(prisma, item.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("ETSY_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }
    const { payload, status } = toEtsyErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}
