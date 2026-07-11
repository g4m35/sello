import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import {
  COOLDOWN_ELIGIBLE_RUN_STATUSES,
  compsRefreshCooldownMs,
  evaluateRefreshCooldown,
} from "@/lib/comps/cooldown";
import { isAdminUser } from "@/lib/auth/admin";
import { requireFeatureAccess } from "@/lib/auth/feature-access";
import { getActiveAccount } from "@/lib/billing/account";
import { accountScope } from "@/lib/billing/scope";
import {
  releaseUsageReservation,
  reserveUsageOrThrow,
  settleUsageReservation,
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
  try {
    const user = await requireSupabaseUser(request);
    requireFeatureAccess(user, "paidComps");
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
    const account = await getActiveAccount(user.id, prisma);
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
        await releaseUsageReservation(usageReservationId, new Date(), prisma);
        return NextResponse.json(
          {
            error: `Comps were just refreshed. Try again in ${cooldown.retryAfterSeconds}s.`,
            retryAfterSeconds: cooldown.retryAfterSeconds,
          },
          { status: 429, headers: { "Retry-After": String(cooldown.retryAfterSeconds) } },
        );
      }
    }

    const result = await runCompFetch(prisma, inventoryItemId, user.id, {
      force: true,
      paidProvidersAllowed: true,
      accountId: account.id,
      adminOverride: isOwner,
      idempotencyKey: requestIdempotencyKey,
    });

    try {
      await settleUsageReservation(usageReservationId, new Date(), prisma);
    } catch (usageError) {
      logUnexpectedError("comp_refresh_usage_settlement", usageError);
    }

    return NextResponse.json(result);
  } catch (error) {
    if (usageReservationId && prisma) {
      await releaseUsageReservation(usageReservationId, new Date(), prisma).catch(
        (usageError) => logUnexpectedError("comp_refresh_usage_release", usageError),
      );
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
