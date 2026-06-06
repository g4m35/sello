import { NextResponse } from "next/server";

import { Prisma } from "@/generated/prisma/client";
import { AppError, getErrorMessage } from "@/lib/errors";
import {
  ImportRequestSchema,
  normalizeCategory,
  normalizeCondition,
} from "@/lib/listing-import";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Bulk-creates DRAFT items from parsed CSV rows. Each row becomes a real
// InventoryItem + ListingDraft in DRAFT status. Nothing is published; prices
// come from the CSV and are never generated.
export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const body = await request.json();
    const parsed = ImportRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(parsed.error.issues[0]?.message ?? "Invalid import payload", 400);
    }

    const prisma = getPrisma();
    const createdIds: string[] = [];

    for (const row of parsed.data.rows) {
      const item = await prisma.inventoryItem.create({
        data: {
          sellerId: user.id,
          status: "DRAFTING",
          productName: row.title,
          brand: row.brand ?? null,
          category: normalizeCategory(row.category),
          condition: normalizeCondition(row.condition),
          styleCode: row.sku ?? null,
          colorway: row.color ?? null,
          size: row.size ?? null,
          recommendedPriceCents: row.priceCents ?? null,
          listingDrafts: {
            create: {
              status: "DRAFT",
              title: row.title,
              description: "",
              bulletPoints: [],
              recommendedPriceCents: row.priceCents ?? null,
              itemSpecifics: {} as Prisma.InputJsonValue,
              marketplaceDrafts: {} as Prisma.InputJsonValue,
              selectedMarketplaces: ["ebay", "grailed", "poshmark", "depop"],
            },
          },
        },
      });
      createdIds.push(item.id);
    }

    return NextResponse.json({ created: createdIds.length, ids: createdIds });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
