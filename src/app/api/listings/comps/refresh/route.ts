import { NextResponse } from "next/server";

import {
  COOLDOWN_ELIGIBLE_RUN_STATUSES,
  compsRefreshCooldownMs,
  evaluateRefreshCooldown,
} from "@/lib/comps/cooldown";
import { isAdminUser } from "@/lib/auth/admin";
import { requireFeatureAccess } from "@/lib/auth/feature-access";
import { getActiveAccount } from "@/lib/billing/account";
import { accountWithEffectivePlan } from "@/lib/billing/effective-plan";
import { accountScope } from "@/lib/billing/scope";
import { assertWithinQuota, incrementUsage } from "@/lib/billing/usage";
import { runCompFetch } from "@/lib/comps/fetch";
import { isCompsPaidProvidersEnabled } from "@/lib/comps/flags";
import { AppError, logUnexpectedError, safeErrorResponse } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Fetches fresh automatic comps for an item from all enabled comp sources.
// Returns 0 honestly when no source is configured (no invented prices).
export async function POST(request: Request) {
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

    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    const item = await prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, ...accountScope(account) },
      select: { id: true },
    });
    if (!item) {
      throw new AppError("Item not found", 404);
    }

    // Monthly paid-refresh quota. Checked before the cooldown so an out-of-quota
    // seller gets a clear 402 upgrade signal rather than a retry timer.
    await assertWithinQuota(
      accountWithEffectivePlan(account, user),
      "comp_refresh",
      new Date(),
    );

    // Cooldown: spam-clicking Refresh must not fire repeated paid provider calls.
    // Only count the last run that actually queried a provider — a disabled,
    // weak-identity, no-source, or failed run never poisons the cooldown, so the
    // seller can retry immediately after one of those.
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
      cooldownMs: compsRefreshCooldownMs(process.env, { isOwner: isAdminUser(user) }),
    });
    if (!cooldown.allowed) {
      return NextResponse.json(
        {
          error: `Comps were just refreshed. Try again in ${cooldown.retryAfterSeconds}s.`,
          retryAfterSeconds: cooldown.retryAfterSeconds,
        },
        { status: 429, headers: { "Retry-After": String(cooldown.retryAfterSeconds) } },
      );
    }

    const result = await runCompFetch(prisma, inventoryItemId, user.id, {
      force: true,
      paidProvidersAllowed: true,
      accountId: account.id,
    });

    // Count the refresh against the monthly quota on success only; a failed
    // fetch (which throws) never burns quota. Best-effort, logged on failure.
    try {
      await incrementUsage(account.id, "comp_refresh", new Date());
    } catch (usageError) {
      logUnexpectedError("comp_refresh_usage_increment", usageError);
    }

    return NextResponse.json(result);
  } catch (error) {
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
