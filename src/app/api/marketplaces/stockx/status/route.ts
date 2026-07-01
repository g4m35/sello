import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getActiveAccount } from "@/lib/billing/account";
import { getPrisma } from "@/lib/prisma";
import { resolveStockXCapabilities } from "@/lib/marketplace/adapters/stockx/capabilities";
import {
  isStockXApiEnabled,
  isStockXOAuthConfigured,
  isStockXListingEnabled,
  isStockXMarketDataEnabled,
} from "@/lib/marketplace/adapters/stockx/config";
import { toStockXErrorPayload } from "@/lib/marketplace/adapters/stockx/errors";
import { STOCKX_ENVIRONMENT } from "@/lib/marketplace/adapters/stockx/types";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUserFromRequestOrCookies(request);
    const capabilities = resolveStockXCapabilities();

    let connected = false;
    if (isStockXOAuthConfigured()) {
      const prisma = getPrisma();
      const account = await getActiveAccount(user.id, prisma);
      const connection = await prisma.marketplaceConnection.findUnique({
        where: {
          accountId_marketplace_environment: {
            accountId: account.id,
            marketplace: "stockx",
            environment: STOCKX_ENVIRONMENT,
          },
        },
        select: { id: true },
      });
      connected = Boolean(connection);
    }

    return NextResponse.json({
      apiEnabled: isStockXApiEnabled(),
      marketDataEnabled: isStockXMarketDataEnabled(),
      listingEnabled: isStockXListingEnabled(),
      connected,
      capabilities,
    });
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("STOCKX_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }
    const { payload, status } = toStockXErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}
