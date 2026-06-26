import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getActiveAccount } from "@/lib/billing/account";
import { getPrisma } from "@/lib/prisma";
import { resolveEtsyCapabilities } from "@/lib/marketplace/adapters/etsy/capabilities";
import { isEtsyApiEnabled } from "@/lib/marketplace/adapters/etsy/config";
import { toEtsyErrorPayload } from "@/lib/marketplace/adapters/etsy/errors";
import { evaluateEtsyReadiness } from "@/lib/marketplace/adapters/etsy/readiness";
import { ETSY_ENVIRONMENT } from "@/lib/marketplace/adapters/etsy/types";
import { requireSupabaseUser } from "@/lib/supabase/server";

export const runtime = "nodejs";

// Informational readiness for the editor's Etsy section. Never throws on the
// not-enabled / not-connected paths: it returns the state so the UI can show the
// copy-ready fallback and the missing requirements.
export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUser(request);
    const url = new URL(request.url);
    const itemId = url.searchParams.get("itemId");
    const capabilities = resolveEtsyCapabilities(user);

    if (!itemId) {
      throw new AppError("itemId is required", 400);
    }

    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    const item = await prisma.inventoryItem.findFirst({
      where: { id: itemId, accountId: account.id },
      include: {
        listingDrafts: { orderBy: { updatedAt: "desc" }, take: 1 },
        photos: { select: { id: true } },
      },
    });
    if (!item) {
      throw new AppError("Item not found", 404);
    }
    const draft = item.listingDrafts[0] ?? null;

    const connection = await prisma.marketplaceConnection.findUnique({
      where: {
        accountId_marketplace_environment: {
          accountId: account.id,
          marketplace: "etsy",
          environment: ETSY_ENVIRONMENT,
        },
      },
      select: { id: true },
    });

    const readiness = evaluateEtsyReadiness({
      apiEnabled: isEtsyApiEnabled(),
      connected: Boolean(connection),
      reconnectRequired: false,
      title: draft?.title ?? item.productName,
      description: draft?.description ?? "",
      priceCents: draft?.recommendedPriceCents ?? item.recommendedPriceCents ?? null,
      quantity: 1,
      photoCount: item.photos.length,
      taxonomyId: url.searchParams.get("taxonomyId"),
      shippingProfileId: url.searchParams.get("shippingProfileId"),
      returnPolicyId: url.searchParams.get("returnPolicyId"),
    });

    return NextResponse.json({ ...readiness, capabilities });
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("ETSY_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }
    const { payload, status } = toEtsyErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}
