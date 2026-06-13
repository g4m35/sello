import { NextResponse } from "next/server";

import type { Prisma } from "@/generated/prisma/client";
import { AppError, getErrorMessage } from "@/lib/errors";
import { UpdatePriceCompSchema, type UpdatePriceCompInput } from "@/lib/pricing/price-comp-input";
import { summarizeComps } from "@/lib/pricing/summarize";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Context = { params: Promise<{ compId: string }> };

// Only copy keys the caller actually sent, converting where the DB type differs.
function toUpdateData(update: UpdatePriceCompInput): Prisma.PriceCompUpdateInput {
  const data: Prisma.PriceCompUpdateInput = {};
  if (update.source !== undefined) data.source = update.source;
  if (update.sourceType !== undefined) data.sourceType = update.sourceType;
  if (update.platform !== undefined) data.platform = update.platform;
  if (update.status !== undefined) data.status = update.status;
  if (update.title !== undefined) data.title = update.title;
  if (update.brand !== undefined) data.brand = update.brand;
  if (update.size !== undefined) data.size = update.size;
  if (update.priceCents !== undefined) data.priceCents = update.priceCents;
  if (update.shippingCents !== undefined) data.shippingCents = update.shippingCents;
  if (update.totalPriceCents !== undefined) data.totalPriceCents = update.totalPriceCents;
  if (update.currency !== undefined) data.currency = update.currency;
  if (update.soldDate !== undefined) data.soldDate = update.soldDate;
  if (update.url !== undefined) data.url = update.url;
  if (update.imageUrl !== undefined) data.imageUrl = update.imageUrl;
  if (update.condition !== undefined) data.condition = update.condition;
  if (update.matchScore !== undefined) data.matchScore = update.matchScore;
  if (update.usedInPricing !== undefined) data.usedInPricing = update.usedInPricing;
  if (update.ignoredAsOutlier !== undefined) data.ignoredAsOutlier = update.ignoredAsOutlier;
  if (update.notes !== undefined) data.notes = update.notes;
  if (update.rawJson !== undefined) {
    data.rawJson = update.rawJson as Prisma.InputJsonValue;
  }
  return data;
}

async function loadOwnedComp(request: Request, compId: string) {
  const user = await requireSupabaseUser(request);
  const prisma = getPrisma();
  const existing = await prisma.priceComp.findFirst({
    where: { id: compId, inventoryItem: { sellerId: user.id } },
    select: { id: true, inventoryItemId: true },
  });
  if (!existing) {
    throw new AppError("Comp not found.", 404);
  }
  return { prisma, existing };
}

async function respondWithComps(
  prisma: ReturnType<typeof getPrisma>,
  inventoryItemId: string,
) {
  const comps = await prisma.priceComp.findMany({
    where: { inventoryItemId },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    inventoryItemId,
    comps,
    summary: summarizeComps(comps),
  });
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { compId } = await context.params;
    const update = UpdatePriceCompSchema.parse(await request.json());
    const { prisma, existing } = await loadOwnedComp(request, compId);

    await prisma.priceComp.update({
      where: { id: existing.id },
      data: toUpdateData(update),
    });

    return respondWithComps(prisma, existing.inventoryItemId);
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { compId } = await context.params;
    const { prisma, existing } = await loadOwnedComp(request, compId);

    await prisma.priceComp.delete({ where: { id: existing.id } });

    return respondWithComps(prisma, existing.inventoryItemId);
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
