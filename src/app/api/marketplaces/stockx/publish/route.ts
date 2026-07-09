import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveAccount } from "@/lib/billing/account";
import { accountWithEffectivePlan } from "@/lib/billing/effective-plan";
import { assertWithinQuota, incrementUsage } from "@/lib/billing/usage";
import { logUnexpectedError, safeErrorResponse } from "@/lib/errors";
import {
  StockXIntegrationError,
  stockxErrorCodes,
  toStockXErrorPayload,
} from "@/lib/marketplace/adapters/stockx/errors";
import {
  executePublish,
  PublishingMigrationMissingError,
} from "@/lib/marketplace/publish-handler";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

const StockXPublishRequestSchema = z
  .object({
    inventoryItemId: z.uuid(),
    confirmLivePublish: z.literal(true),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const body = StockXPublishRequestSchema.parse(await request.json());
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    await assertWithinQuota(
      accountWithEffectivePlan(account, user),
      "autopublish",
      new Date(),
      { user },
    );

    const result = await executePublish(prisma, {
      userId: user.id,
      accountId: account.id,
      inventoryItemId: body.inventoryItemId,
      marketplace: "stockx",
      confirmLivePublish: true,
    });

    if (result.httpStatus >= 200 && result.httpStatus < 300) {
      try {
        await incrementUsage(account.id, "autopublish", new Date());
      } catch (usageError) {
        logUnexpectedError("stockx_autopublish_usage_increment", usageError);
      }
    }

    return NextResponse.json(
      {
        ...result.outcome,
        marketplaceListingId: result.marketplaceListingId,
        publishAttemptId: result.publishAttemptId,
      },
      { status: result.httpStatus },
    );
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          error: {
            code: stockxErrorCodes.confirmationRequired,
            message: "Confirm before creating a live StockX listing.",
          },
        },
        { status: 400 },
      );
    }

    if (error instanceof PublishingMigrationMissingError) {
      return NextResponse.json({ error: error.toPayload() }, { status: error.status });
    }

    if (error instanceof StockXIntegrationError) {
      const { payload, status } = toStockXErrorPayload(error);
      return NextResponse.json({ error: payload }, { status });
    }

    const { status, body } = safeErrorResponse(error, {
      label: "stockx_publish",
      fallbackCode: stockxErrorCodes.listingFailed,
    });
    return NextResponse.json(body, { status });
  }
}
