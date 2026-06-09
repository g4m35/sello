import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, getErrorMessage } from "@/lib/errors";
import {
  buildListingExport,
  ExportMarketplaceSchema,
  type ExportMarketplace,
} from "@/lib/marketplace/export-formatters";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

const SpecificsSchema = z.record(z.string(), z.string());
const MarketplaceTagsSchema = z.object({ tags: z.array(z.string()) });

function specificsOf(value: unknown): Record<string, string> {
  const parsed = SpecificsSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function tagsOf(marketplaceDrafts: unknown, marketplace: ExportMarketplace): string[] {
  if (typeof marketplaceDrafts !== "object" || marketplaceDrafts === null) return [];
  const entry = (marketplaceDrafts as Record<string, unknown>)[marketplace];
  const parsed = MarketplaceTagsSchema.safeParse(entry);
  return parsed.success ? parsed.data.tags : [];
}

// Copy/paste export for marketplaces without a publish adapter. Returns
// platform-formatted listing text; it does not publish or enqueue anything.
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireSupabaseUser(request);
    const { id } = await params;

    const marketplaceParam = new URL(request.url).searchParams.get("marketplace");
    const parsed = ExportMarketplaceSchema.safeParse(marketplaceParam);
    if (!parsed.success) {
      throw new AppError("Unsupported marketplace. Use depop, poshmark, or grailed.", 400);
    }
    const marketplace = parsed.data;

    const prisma = getPrisma();
    const item = await prisma.inventoryItem.findFirst({
      where: { id, sellerId: user.id },
      include: { listingDrafts: { orderBy: { updatedAt: "desc" }, take: 1 } },
    });
    if (!item) {
      throw new AppError("Item not found", 404);
    }

    const draft = item.listingDrafts[0] ?? null;
    const exported = buildListingExport(marketplace, {
      productName: item.productName,
      brand: item.brand,
      size: item.size,
      colorway: item.colorway,
      styleCode: item.styleCode,
      category: item.category,
      condition: item.condition,
      title: draft?.title ?? "",
      description: draft?.description ?? "",
      bulletPoints: draft?.bulletPoints ?? [],
      priceCents: draft?.recommendedPriceCents ?? item.recommendedPriceCents ?? null,
      itemSpecifics: specificsOf(draft?.itemSpecifics),
      tags: tagsOf(draft?.marketplaceDrafts, marketplace),
    });

    const warnings = [...exported.warnings];
    if (!draft) {
      warnings.push("No listing draft exists for this item yet");
    } else if (draft.status !== "APPROVED") {
      warnings.push("Draft has not been approved yet");
    }

    return NextResponse.json({ ...exported, warnings });
  } catch (error) {
    const status = error instanceof AppError ? error.status : 500;
    return NextResponse.json({ error: getErrorMessage(error) }, { status });
  }
}
