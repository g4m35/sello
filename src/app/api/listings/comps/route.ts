import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { calculatePricing } from "@/lib/pricing/comps";
import { CreatePriceCompRequestSchema } from "@/lib/pricing/price-comp-input";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

type CompRow = { priceCents: number; shippingCents: number };

function summarize(comps: CompRow[]) {
  return calculatePricing(
    comps.map((comp) => ({
      priceCents: comp.priceCents,
      shippingCents: comp.shippingCents,
    })),
  );
}

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
      summary: summarize(comps),
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

    const created = await prisma.priceComp.create({
      data: {
        inventoryItemId: inventoryItem.id,
        source: comp.source,
        title: comp.title,
        priceCents: comp.priceCents,
        shippingCents: comp.shippingCents,
        soldDate: comp.soldDate ?? null,
        url: comp.url ?? null,
        condition: comp.condition,
        notes: comp.notes ?? null,
      },
    });

    const comps = await prisma.priceComp.findMany({
      where: { inventoryItemId: inventoryItem.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      inventoryItemId: inventoryItem.id,
      comp: created,
      comps,
      summary: summarize(comps),
    });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 400;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
