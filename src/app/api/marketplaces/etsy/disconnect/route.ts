import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getActiveAccount } from "@/lib/billing/account";
import { assertCanManageMarketplaceConnections } from "@/lib/billing/connections";
import { getPrisma } from "@/lib/prisma";
import { toEtsyErrorPayload } from "@/lib/marketplace/adapters/etsy/errors";
import { ETSY_ENVIRONMENT } from "@/lib/marketplace/adapters/etsy/types";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUserFromRequestOrCookies(request);
    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    await assertCanManageMarketplaceConnections(account, user.id, prisma);

    // Removing the connection revokes Sello's stored token access for this seller.
    // Scoped to the active account, so members cannot disconnect other accounts.
    await prisma.marketplaceConnection.deleteMany({
      where: {
        accountId: account.id,
        marketplace: "etsy",
        environment: ETSY_ENVIRONMENT,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("ETSY_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }

    const { payload, status } = toEtsyErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}

export const DELETE = POST;
