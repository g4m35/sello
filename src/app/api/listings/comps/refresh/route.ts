import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  COOLDOWN_ELIGIBLE_RUN_STATUSES,
  compsRefreshCooldownMs,
  evaluateRefreshCooldown,
} from "@/lib/comps/cooldown";
import { isAdminUser } from "@/lib/auth/admin";
import { requireRuntimeFeatureAccess } from "@/lib/auth/feature-access";
import { accountScope } from "@/lib/billing/scope";
import {
  markUsageReconciliationRequired,
  markUsageWorkStarted,
  releaseUsageReservation,
  reserveUsageOrThrow,
  settleUsageReservationOrRequireReconciliation,
} from "@/lib/billing/usage";
import { runCompFetch } from "@/lib/comps/fetch";
import { isCompsPaidProvidersEnabled } from "@/lib/comps/flags";
import { AppError, logUnexpectedError, safeErrorResponse } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Fetches fresh automatic comps for an item from all enabled comp sources.
// Returns 0 honestly when no source is configured (no invented prices).
export async function POST(request: Request) {
  let usageReservationId: string | null = null;
  let prisma: ReturnType<typeof getPrisma> | null = null;
  let workStarted = false;
  let meteredWorkCompleted = false;
  try {
    const user = await requireSupabaseUser(request);
    const body = await request.json();
    const inventoryItemId: unknown = body?.inventoryItemId;
    if (typeof inventoryItemId !== "string" || !inventoryItemId) {
      throw new AppError("inventoryItemId is required", 400);
    }
    if (!isCompsPaidProvidersEnabled()) {
      throw new AppError(
        "Fresh sold comps are disabled right now. Manual comps still work.",
        409,
        "PAID_COMPS_DISABLED",
      );
    }
    prisma = getPrisma();
    const runtimeEntitlements = await requireRuntimeFeatureAccess(
      user,
      "paidComps",
      prisma,
    );

    const account = runtimeEntitlements.account;
    const item = await prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, ...accountScope(account) },
      select: { id: true },
    });
    if (!item) {
      throw new AppError("Item not found", 404);
    }

    const requestIdempotencyKey = request.headers.get("idempotency-key") ?? randomUUID();
    const reservation = await reserveUsageOrThrow({
      accountId: account.id,
      metric: "comp_refresh",
      idempotencyKey: requestIdempotencyKey,
      now: new Date(),
      operationType: "comp_refresh",
      operationId: inventoryItemId,
      user,
    }, prisma);
    if (reservation.idempotent) {
      throw new AppError(
        "This comp-refresh request is already in progress or completed.",
        409,
        "USAGE_REQUEST_ALREADY_RESERVED",
      );
    }
    usageReservationId = reservation.reservationId;

    // Cooldown: spam-clicking Refresh must not fire repeated paid provider calls.
    // Only count the last run that actually queried a provider — a disabled,
    // weak-identity, no-source, or failed run never poisons the cooldown, so the
    // seller can retry immediately after one of those. Admins skip cooldown.
    const isOwner = isAdminUser(user);
    if (!isOwner) {
      const lastRun = await prisma.compSearchRun.findFirst({
        where: {
          inventoryItemId,
          status: { in: [...COOLDOWN_ELIGIBLE_RUN_STATUSES] },
        },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });
      const cooldown = evaluateRefreshCooldown({
        lastRunAt: lastRun?.createdAt ?? null,
        now: new Date(),
        cooldownMs: compsRefreshCooldownMs(process.env, { isOwner: false }),
      });
      if (!cooldown.allowed) {
        try {
          await releaseUsageReservation(usageReservationId, new Date(), prisma);
        } catch (usageError) {
          logUnexpectedError("comp_refresh_usage_release", usageError);
        }
        return NextResponse.json(
          {
            error: `Comps were just refreshed. Try again in ${cooldown.retryAfterSeconds}s.`,
            retryAfterSeconds: cooldown.retryAfterSeconds,
          },
          { status: 429, headers: { "Retry-After": String(cooldown.retryAfterSeconds) } },
        );
      }
    }

    workStarted = await markUsageWorkStarted(usageReservationId, new Date(), prisma);
    if (!workStarted) {
      throw new AppError(
        "Comp refresh could not start because its usage reservation is no longer active.",
        409,
        "USAGE_RESERVATION_NOT_ACTIVE",
      );
    }
    const result = await runCompFetch(prisma, inventoryItemId, user.id, {
      force: true,
      paidProvidersAllowed: true,
      accountId: account.id,
      adminOverride: isOwner,
      idempotencyKey: requestIdempotencyKey,
    });
    meteredWorkCompleted = true;

    await settleUsageReservationOrRequireReconciliation(
      usageReservationId,
      new Date(),
      "COMP_REFRESH_SETTLEMENT_FAILED",
      prisma,
    );

    return NextResponse.json(result);
  } catch (error) {
    if (usageReservationId && prisma) {
      if (workStarted || meteredWorkCompleted) {
        await markUsageReconciliationRequired(
          usageReservationId,
          new Date(),
          meteredWorkCompleted
            ? "COMP_REFRESH_SETTLEMENT_FAILED"
            : "COMP_REFRESH_OUTCOME_UNKNOWN",
          prisma,
        ).catch((usageError) => logUnexpectedError("comp_refresh_usage_reconcile", usageError));
      } else {
        await releaseUsageReservation(usageReservationId, new Date(), prisma).catch(
          (usageError) => logUnexpectedError("comp_refresh_usage_release", usageError),
        );
      }
    }
    // Sanitized: an unexpected failure (e.g. a Prisma/DB error) never leaks raw
    // internals. AppError keeps its code/message; everything else collapses to a
    // stable code + seller-safe copy. Manual comps are unaffected by this path.
    const { status, body } = safeErrorResponse(error, {
      label: "comps_refresh",
      fallbackCode: "COMPS_REFRESH_FAILED",
      fallbackMessage:
        "Couldn't refresh sold comps right now. Manual comps still work; please try again.",
    });
    return NextResponse.json(body, { status });
  }
}
