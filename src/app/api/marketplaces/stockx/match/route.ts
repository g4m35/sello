import { NextResponse } from "next/server";
import { z } from "zod";

import { Prisma } from "@/generated/prisma/client";
import { getActiveAccount } from "@/lib/billing/account";
import { inventoryChildScope } from "@/lib/billing/scope";
import { safeClientMessage } from "@/lib/errors";
import {
  StockXIntegrationError,
  stockxErrorCodes,
  toStockXErrorPayload,
} from "@/lib/marketplace/adapters/stockx/errors";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUser } from "@/lib/supabase/server";
import { loadItemDetailState } from "@/lib/view/load-item-detail";

export const runtime = "nodejs";

const StockXMatchRequestSchema = z
  .object({
    draftId: z.uuid(),
    productId: z.string().trim().min(1).max(120),
    variantId: z.string().trim().min(1).max(120).nullable().optional(),
    title: z.string().trim().min(1).max(240),
    brand: z.string().trim().max(120).nullable().optional(),
    model: z.string().trim().max(120).nullable().optional(),
    style: z.string().trim().max(120).nullable().optional(),
    colorway: z.string().trim().max(160).nullable().optional(),
    color: z.string().trim().max(120).nullable().optional(),
    size: z.string().trim().max(80).nullable().optional(),
    image: z.string().trim().max(500).nullable().optional(),
    category: z.string().trim().max(120).nullable().optional(),
    url: z.string().trim().max(500).nullable().optional(),
    matchSource: z.enum(["catalog_search", "manual"]).optional().default("catalog_search"),
    matchConfidence: z.number().min(0).max(1).nullable().optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const input = StockXMatchRequestSchema.parse(await request.json());
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);

    const existingDraft = await prisma.listingDraft.findFirst({
      where: {
        id: input.draftId,
        ...inventoryChildScope(account),
      },
      select: {
        id: true,
        inventoryItemId: true,
        marketplaceDrafts: true,
      },
    });

    if (!existingDraft) {
      throw new StockXIntegrationError(
        stockxErrorCodes.matchSaveFailed,
        "Listing draft not found.",
        404,
      );
    }

    const marketplaceDrafts = mergeStockXDraft(existingDraft.marketplaceDrafts, input);
    await prisma.listingDraft.update({
      where: { id: existingDraft.id },
      data: {
        stockxProductId: input.productId,
        stockxVariantId: input.variantId ?? null,
        stockxMatchSource: input.matchSource,
        stockxMatchConfidence: input.matchConfidence ?? null,
        marketplaceDrafts: marketplaceDrafts as Prisma.InputJsonValue,
      },
    });

    let item = null;
    try {
      item = await loadItemDetailState(existingDraft.inventoryItemId, account);
    } catch {
      item = null;
    }

    return NextResponse.json({ ok: true, item });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid StockX match selection." },
        { status: 400 },
      );
    }
    const { payload, status } = toStockXErrorPayload(error);
    if (payload.code !== "STOCKX_API_FAILED") {
      return NextResponse.json({ error: payload }, { status });
    }
    return NextResponse.json(
      { error: safeClientMessage(error, { label: "stockx_match_save" }) },
      { status },
    );
  }
}

function mergeStockXDraft(
  existing: Prisma.JsonValue,
  input: z.infer<typeof StockXMatchRequestSchema>,
) {
  const current =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};

  return {
    ...current,
    stockx: {
      productId: input.productId,
      variantId: input.variantId ?? null,
      title: input.title,
      brand: input.brand ?? null,
      model: input.model ?? null,
      style: input.style ?? null,
      colorway: input.colorway ?? null,
      color: input.color ?? null,
      size: input.size ?? null,
      image: input.image ?? null,
      category: input.category ?? null,
      url: input.url ?? null,
      matchSource: input.matchSource,
      matchConfidence: input.matchConfidence ?? null,
      matchedAt: new Date().toISOString(),
    },
  };
}
