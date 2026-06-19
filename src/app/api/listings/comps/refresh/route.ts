import { NextResponse } from "next/server";

import {
  compsRefreshCooldownMs,
  evaluateRefreshCooldown,
} from "@/lib/comps/cooldown";
import { requireFeatureAccess } from "@/lib/auth/feature-access";
import { runCompFetch } from "@/lib/comps/fetch";
import { isCompsPaidProvidersEnabled } from "@/lib/comps/flags";
import { AppError, safeErrorResponse } from "@/lib/errors";
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
    const item = await prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, sellerId: user.id },
      select: { id: true },
    });
    if (!item) {
      throw new AppError("Item not found", 404);
    }

    // Cooldown: spam-clicking Refresh must not fire repeated paid provider calls.
    const lastRun = await prisma.compSearchRun.findFirst({
      where: { inventoryItemId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const cooldown = evaluateRefreshCooldown({
      lastRunAt: lastRun?.createdAt ?? null,
      now: new Date(),
      cooldownMs: compsRefreshCooldownMs(),
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
    });
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
