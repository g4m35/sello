import { NextResponse } from "next/server";

import { safeErrorResponse } from "@/lib/errors";
import { requireFeatureAccess } from "@/lib/auth/feature-access";
import { getActiveAccount } from "@/lib/billing/account";
import { DelistRequestSchema } from "@/lib/marketplace/delist-request";
import { EbayIntegrationError } from "@/lib/marketplace/adapters/ebay/errors";
import {
  type DelistPrismaLike,
  executeEbayDelist,
} from "@/lib/marketplace/delist-handler";
import { PublishingMigrationMissingError } from "@/lib/marketplace/publish-handler";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    requireFeatureAccess(user, "ebayDelist");
    const parsed = DelistRequestSchema.parse(await request.json());
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);

    const result = await executeEbayDelist(prisma as unknown as DelistPrismaLike, {
      userId: user.id,
      accountId: account.id,
      inventoryItemId: parsed.inventoryItemId,
      confirmLiveDelist: parsed.confirmLiveDelist,
    });

    return NextResponse.json(result, { status: result.httpStatus });
  } catch (error) {
    if (error instanceof PublishingMigrationMissingError) {
      return NextResponse.json({ error: error.toPayload() }, { status: error.status });
    }

    if (error instanceof EbayIntegrationError) {
      return NextResponse.json({ error: error.toPayload() }, { status: error.status });
    }

    const { status, body } = safeErrorResponse(error, {
      label: "listings_delist",
      fallbackCode: "DELIST_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
