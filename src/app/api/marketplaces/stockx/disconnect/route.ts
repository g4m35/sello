import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import { assertCanManageMarketplaceConnections } from "@/lib/billing/connections";
import { AppError, getErrorMessage } from "@/lib/errors";
import { toStockXErrorPayload } from "@/lib/marketplace/adapters/stockx/errors";
import { STOCKX_ENVIRONMENT } from "@/lib/marketplace/adapters/stockx/types";
import { getPrisma } from "@/lib/prisma";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUserFromRequestOrCookies(request);
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    await assertCanManageMarketplaceConnections(account, user.id, prisma);

    await prisma.marketplaceConnection.deleteMany({
      where: {
        accountId: account.id,
        marketplace: "stockx",
        environment: STOCKX_ENVIRONMENT,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("STOCKX_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }
    const { payload, status } = toStockXErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}

export const DELETE = POST;
