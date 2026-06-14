import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
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

    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
