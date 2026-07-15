import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveAccount } from "@/lib/billing/account";
import {
  markUsageReconciliationRequired,
  markUsageWorkStarted,
  releaseUsageReservation,
  reserveUsageOrThrow,
  settleUsageReservationOrRequireReconciliation,
} from "@/lib/billing/usage";
import { AppError, logUnexpectedError, safeErrorResponse } from "@/lib/errors";
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
  let usageReservationId: string | null = null;
  let prisma: ReturnType<typeof getPrisma> | null = null;
  let workStarted = false;
  try {
    const user = await requireSupabaseUser(request);
    const body = StockXPublishRequestSchema.parse(await request.json());
    prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    const reservation = await reserveUsageOrThrow({
      accountId: account.id,
      metric: "autopublish",
      idempotencyKey:
        request.headers.get("idempotency-key") ?? randomUUID(),
      now: new Date(),
      operationType: "marketplace_publish",
      operationId: `${body.inventoryItemId}:stockx`,
      user,
    }, prisma);
    if (reservation.idempotent) {
      throw new AppError(
        "This StockX publish request is already in progress or completed.",
        409,
        "USAGE_REQUEST_ALREADY_RESERVED",
      );
    }
    usageReservationId = reservation.reservationId;
    workStarted = await markUsageWorkStarted(usageReservationId, new Date(), prisma);
    if (!workStarted) {
      throw new AppError(
        "StockX publish could not start because its usage reservation is no longer active.",
        409,
        "USAGE_RESERVATION_NOT_ACTIVE",
      );
    }

    const result = await executePublish(prisma, {
      userId: user.id,
      accountId: account.id,
      inventoryItemId: body.inventoryItemId,
      marketplace: "stockx",
      confirmLivePublish: true,
    });

    if (result.httpStatus >= 200 && result.httpStatus < 300) {
      try {
        await settleUsageReservationOrRequireReconciliation(
          usageReservationId,
          new Date(),
          "STOCKX_AUTOPUBLISH_SETTLEMENT_FAILED",
          prisma,
        );
      } catch (usageError) {
        logUnexpectedError("stockx_autopublish_usage_settle", usageError);
        await markUsageReconciliationRequired(
          usageReservationId,
          new Date(),
          "STOCKX_AUTOPUBLISH_SETTLEMENT_FAILED",
          prisma,
        ).catch((reconciliationError) =>
          logUnexpectedError("stockx_autopublish_usage_reconcile", reconciliationError),
        );
      }
    } else {
      try {
        await releaseUsageReservation(
          usageReservationId,
          new Date(),
          prisma,
          "released",
          { allowStartedWork: true },
        );
      } catch (usageError) {
        logUnexpectedError("stockx_autopublish_usage_release", usageError);
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
    if (usageReservationId && prisma) {
      if (workStarted) {
        await markUsageReconciliationRequired(
          usageReservationId,
          new Date(),
          "STOCKX_AUTOPUBLISH_OUTCOME_UNKNOWN",
          prisma,
        ).catch((usageError) =>
          logUnexpectedError("stockx_autopublish_usage_reconcile", usageError),
        );
      } else {
        await releaseUsageReservation(usageReservationId, new Date(), prisma).catch(
          (usageError) => logUnexpectedError("stockx_autopublish_usage_release", usageError),
        );
      }
    }
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
