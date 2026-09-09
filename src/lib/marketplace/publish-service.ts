import type { PublishAuthorization } from "@/lib/automation/policy";
import { randomUUID } from "node:crypto";

import { z } from "zod";

import { AppError, logUnexpectedError } from "@/lib/errors";
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
import {
  StockXIntegrationError,
  stockxErrorCodes,
} from "@/lib/marketplace/adapters/stockx/errors";
import { executePublish } from "@/lib/marketplace/publish-handler";
import { PublishRequestSchema } from "@/lib/marketplace/publish-request";

export async function publishForUser(
  user: { id: string; email?: string | null },
  input: z.infer<typeof PublishRequestSchema>,
  idempotencyKey?: string,
  expectedAccountId?: string,
  authorization?: PublishAuthorization,
) {
  let usageReservationId: string | null = null;
  let prisma: ReturnType<typeof getPrisma> | null = null;
  let workStarted = false;
  try {
    const { inventoryItemId, marketplace, confirmLivePublish } = PublishRequestSchema.parse(input);
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
    if (expectedAccountId && account.id !== expectedAccountId) {
      throw new AppError("The active account changed. Review this listing before publishing.", 409, "AUTOMATION_ACCOUNT_CHANGED");
    }
    const reservation = await reserveUsageOrThrow({
      accountId: account.id,
      metric: "autopublish",
      idempotencyKey:
        idempotencyKey ?? randomUUID(),
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
      authorization,
    });

    // Count only a real, successful publish. Draft-only NOT_IMPLEMENTED (501),
    // failures, and blocked not_enabled outcomes (sandbox returns those as a
    // 200 with a typed code, but nothing was published) never burn quota. If
    // settlement is temporarily unavailable, the already-started reservation
    // stays charged and is marked for reconciliation; the successful external
    // outcome is still returned so a seller is not encouraged to publish the
    // same listing again.
    const publishedForQuota =
      result.httpStatus >= 200 &&
      result.httpStatus < 300 &&
      result.outcome.status !== "not_enabled";
    if (publishedForQuota) {
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

    return result;
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
    throw error;
  }
}
