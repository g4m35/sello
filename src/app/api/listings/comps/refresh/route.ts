import { NextResponse } from "next/server";

import {
  compsRefreshCooldownMs,
  evaluateRefreshCooldown,
} from "@/lib/comps/cooldown";
import { runCompFetch } from "@/lib/comps/fetch";
import { AppError, getErrorMessage } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Fetches fresh automatic comps for an item from all enabled comp sources.
// Returns 0 honestly when no source is configured (no invented prices).
export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const body = await request.json();
    const inventoryItemId: unknown = body?.inventoryItemId;
    if (typeof inventoryItemId !== "string" || !inventoryItemId) {
      throw new AppError("inventoryItemId is required", 400);
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

    const result = await runCompFetch(prisma, inventoryItemId, user.id, { force: true });
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
