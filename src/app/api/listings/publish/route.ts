import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { AppError, logUnexpectedError, safeErrorResponse } from "@/lib/errors";
import { requireRuntimeFeatureAccess } from "@/lib/auth/feature-access";
import { getActiveAccount } from "@/lib/billing/account";
import {
  markUsageReconciliationRequired,
  markUsageWorkStarted,
  releaseUsageReservation,
  reserveUsageOrThrow,
  settleUsageReservationOrRequireReconciliation,
} from "@/lib/billing/usage";
import { getPrisma } from "@/lib/prisma";
import { getEbayEnvironment } from "@/lib/marketplace/adapters/ebay/config";
import { EbayIntegrationError } from "@/lib/marketplace/adapters/ebay/errors";
import {
  StockXIntegrationError,
  stockxErrorCodes,
} from "@/lib/marketplace/adapters/stockx/errors";
import {
  executePublish,
  PublishingMigrationMissingError,
} from "@/lib/marketplace/publish-handler";
import { PublishRequestSchema } from "@/lib/marketplace/publish-request";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Non-eBay marketplaces remain draft-only and return a typed NOT_IMPLEMENTED
// outcome. eBay runs the guarded sandbox publish flow: blocked (typed
// EBAY_PUBLISH_NOT_ENABLED) unless EBAY_SANDBOX_PUBLISH_ENABLED=true. Every
// attempt is persisted for audit; the route never fakes a success.
export async function POST(request: Request) {
  let usageReservationId: string | null = null;
  let prisma: ReturnType<typeof getPrisma> | null = null;
  let workStarted = false;
  try {
    const user = await requireSupabaseUser(request);
    const { inventoryItemId, marketplace, confirmLivePublish } = PublishRequestSchema.parse(
      await request.json(),
    );
    if (marketplace === "stockx" && confirmLivePublish !== true) {
      throw new StockXIntegrationError(
        stockxErrorCodes.confirmationRequired,
        "Confirm before creating a live StockX listing.",
        400,
      );
    }

    // Monthly autopublish quota, enforced before the publish attempt.
    prisma = getPrisma();
    const runtimeEntitlements =
      marketplace === "ebay" && getEbayEnvironment() === "production"
        ? await requireRuntimeFeatureAccess(user, "liveEbayPublish", prisma)
        : null;
    const account = runtimeEntitlements?.account ?? (await getActiveAccount(user.id, prisma));
    const reservation = await reserveUsageOrThrow({
      accountId: account.id,
      metric: "autopublish",
      idempotencyKey:
        request.headers.get("idempotency-key") ?? randomUUID(),
      now: new Date(),
      operationType: "marketplace_publish",
      operationId: `${inventoryItemId}:${marketplace}`,
      user,
    }, prisma);
    if (reservation.idempotent) {
      throw new AppError(
        "This publish request is already in progress or completed.",
        409,
        "USAGE_REQUEST_ALREADY_RESERVED",
      );
    }
    usageReservationId = reservation.reservationId;
    workStarted = await markUsageWorkStarted(usageReservationId, new Date(), prisma);
    if (!workStarted) {
      throw new AppError(
        "Publish could not start because its usage reservation is no longer active.",
        409,
        "USAGE_RESERVATION_NOT_ACTIVE",
      );
    }

    const result = await executePublish(prisma, {
      userId: user.id,
      accountId: account.id,
      inventoryItemId,
      marketplace,
      confirmLivePublish,
    });

    // Count only a real, successful publish (2xx). Draft-only NOT_IMPLEMENTED
    // (501) and failures never burn quota. If settlement is temporarily
    // unavailable, the already-started reservation stays charged and is marked
    // for reconciliation; the successful external outcome is still returned so
    // a seller is not encouraged to publish the same listing again.
    if (result.httpStatus >= 200 && result.httpStatus < 300) {
      try {
        await settleUsageReservationOrRequireReconciliation(
          usageReservationId,
          new Date(),
          "AUTOPUBLISH_SETTLEMENT_FAILED",
          prisma,
        );
      } catch (usageError) {
        logUnexpectedError("autopublish_usage_settle", usageError);
        await markUsageReconciliationRequired(
          usageReservationId,
          new Date(),
          "AUTOPUBLISH_SETTLEMENT_FAILED",
          prisma,
        ).catch((reconciliationError) =>
          logUnexpectedError("autopublish_usage_reconcile", reconciliationError),
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
        logUnexpectedError("autopublish_usage_release", usageError);
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
          "AUTOPUBLISH_OUTCOME_UNKNOWN",
          prisma,
        ).catch((usageError) => logUnexpectedError("autopublish_usage_reconcile", usageError));
      } else {
        await releaseUsageReservation(usageReservationId, new Date(), prisma).catch(
          (usageError) => logUnexpectedError("autopublish_usage_release", usageError),
        );
      }
    }
    if (error instanceof PublishingMigrationMissingError) {
      return NextResponse.json({ error: error.toPayload() }, { status: error.status });
    }

    if (error instanceof EbayIntegrationError) {
      return NextResponse.json({ error: error.toPayload() }, { status: error.status });
    }

    if (error instanceof StockXIntegrationError) {
      return NextResponse.json({ error: error.toPayload() }, { status: error.status });
    }

    const { status, body } = safeErrorResponse(error, {
      label: "listings_publish",
      fallbackCode: "PUBLISH_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
