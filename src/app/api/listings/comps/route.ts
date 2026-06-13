import { NextResponse } from "next/server";

import type { Prisma } from "@/generated/prisma/client";
import { AppError, getErrorMessage } from "@/lib/errors";
import { calculatePricing } from "@/lib/pricing/comps";
import { CreatePriceCompRequestSchema } from "@/lib/pricing/price-comp-input";
import { summarizeComps } from "@/lib/pricing/summarize";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const prisma = getPrisma();

    const requestedItemId = new URL(request.url).searchParams.get("inventoryItemId");

    const inventoryItem = requestedItemId
      ? await prisma.inventoryItem.findFirst({
          where: { id: requestedItemId, sellerId: user.id },
          select: { id: true },
        })
      : await prisma.inventoryItem.findFirst({
          where: { sellerId: user.id },
          orderBy: { updatedAt: "desc" },
          select: { id: true },
        });

    if (!inventoryItem) {
      return NextResponse.json({
        inventoryItemId: null,
        comps: [],
        summary: calculatePricing([]),
      });
    }

    const comps = await prisma.priceComp.findMany({
      where: { inventoryItemId: inventoryItem.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      inventoryItemId: inventoryItem.id,
      comps,
      summary: summarizeComps(comps),
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const { inventoryItemId, comp } = CreatePriceCompRequestSchema.parse(
      await request.json(),
    );
    const prisma = getPrisma();

    const inventoryItem = await prisma.inventoryItem.findFirst({
      where: { id: inventoryItemId, sellerId: user.id },
      select: { id: true },
    });

    if (!inventoryItem) {
      throw new AppError("Inventory item not found.", 404);
    }

    await prisma.priceComp.create({
      data: {
        inventoryItemId: inventoryItem.id,
        source: comp.source,
        sourceType: comp.sourceType,
        platform: comp.platform ?? null,
        status: comp.status,
        title: comp.title,
        brand: comp.brand ?? null,
        size: comp.size ?? null,
        priceCents: comp.priceCents,
        shippingCents: comp.shippingCents,
        totalPriceCents: comp.totalPriceCents ?? null,
        currency: comp.currency,
        soldDate: comp.soldDate ?? null,
        url: comp.url ?? null,
        imageUrl: comp.imageUrl ?? null,
        condition: comp.condition,
        matchScore: comp.matchScore ?? null,
        usedInPricing: comp.usedInPricing,
        ignoredAsOutlier: comp.ignoredAsOutlier,
        rawJson:
          comp.rawJson === undefined
            ? undefined
            : (comp.rawJson as Prisma.InputJsonValue),
        notes: comp.notes ?? null,
      },
    });

    const comps = await prisma.priceComp.findMany({
      where: { inventoryItemId: inventoryItem.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      inventoryItemId: inventoryItem.id,
      comps,
      summary: summarizeComps(comps),
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
