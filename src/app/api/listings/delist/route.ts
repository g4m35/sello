import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { requireFeatureAccess } from "@/lib/auth/feature-access";
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

    const result = await executeEbayDelist(getPrisma() as unknown as DelistPrismaLike, {
      userId: user.id,
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

    if (error instanceof AppError) {
      return NextResponse.json(
        {
          error: {
            code: error.code ?? "REQUEST_FAILED",
            message: error.message,
          },
        },
        { status: error.status },
      );
    }

    return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
  }
}
