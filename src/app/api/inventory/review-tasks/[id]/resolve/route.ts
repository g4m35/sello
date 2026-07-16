import { NextResponse } from "next/server";
import { z } from "zod";

import { getActiveAccount } from "@/lib/billing/account";
import { AppError, safeErrorResponse } from "@/lib/errors";
import { markItemSold } from "@/lib/inventory/mark-sold";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Seller resolves (confirms-as-handled) or dismisses one of their review tasks.
// Ownership is enforced in the same write: updateMany is scoped to the active
// account, so every active member sees the same task queue while foreign
// accounts remain indistinguishable from missing rows.
// resolvedAt is stamped so the task leaves the open queue. Resolving a
// confirm_possible_sale task is the seller's explicit confirmation, so it also
// runs the canonical mark-sold transaction and queues safe delisting work.

const BodySchema = z
  .object({
    status: z.enum(["resolved", "dismissed"]),
  })
  .strict();

function payloadString(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function payloadNumber(payload: unknown, key: string): number | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSupabaseUserFromRequestOrCookies(request);
    const { id } = await params;
    const body = BodySchema.parse(await request.json());
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    const task = await prisma.reviewTask.findFirst({
      where: { id, accountId: account.id, status: "open" },
      select: {
        type: true,
        inventoryItemId: true,
        marketplace: true,
        payload: true,
      },
    });

    if (!task) {
      throw new AppError("Review task not found.", 404);
    }

    const resolvedAt = new Date();
    const updated = await prisma.reviewTask.updateMany({
      where: { id, accountId: account.id, status: "open" },
      data: { status: body.status, resolvedAt },
    });

    if (updated.count === 0) {
      // Either not owned, not found, or already closed — never reveal which.
      throw new AppError("Review task not found.", 404);
    }

    if (body.status === "resolved" && task.type === "confirm_possible_sale") {
      if (!task.inventoryItemId || !task.marketplace) {
        await prisma.reviewTask.updateMany({
          where: { id, accountId: account.id, status: "resolved", resolvedAt },
          data: { status: "open", resolvedAt: null },
        });
        throw new AppError(
          "This sale confirmation is missing required listing details.",
          409,
          "SALE_CONFIRMATION_INCOMPLETE",
        );
      }
      try {
        await markItemSold(prisma as never, {
          inventoryItemId: task.inventoryItemId,
          userId: user.id,
          accountId: account.id,
          soldMarketplace: task.marketplace,
          soldListingId: payloadString(task.payload, "externalListingId"),
          sourceMarketplaceListingId: payloadString(task.payload, "marketplaceListingId"),
          soldPriceCents: payloadNumber(task.payload, "price"),
          source: "manual",
        });
      } catch (error) {
        // Re-open only the claim made by this request. If another actor changed
        // the task meanwhile, the conditional update leaves their choice intact.
        await prisma.reviewTask.updateMany({
          where: { id, accountId: account.id, status: "resolved", resolvedAt },
          data: { status: "open", resolvedAt: null },
        });
        throw error;
      }
    }

    return NextResponse.json({ ok: true, id, status: body.status });
  } catch (error) {
    const { status, body } = safeErrorResponse(error, {
      label: "inventory_review_task_resolve",
      fallbackCode: "REVIEW_TASK_RESOLVE_FAILED",
    });
    return NextResponse.json(body, { status });
  }
}
