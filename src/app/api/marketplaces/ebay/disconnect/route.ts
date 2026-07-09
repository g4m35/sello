import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getActiveAccount } from "@/lib/billing/account";
import { assertCanManageMarketplaceConnections } from "@/lib/billing/connections";
import { getPrisma } from "@/lib/prisma";
import { getEbayEnvironment } from "@/lib/marketplace/adapters/ebay/config";
import { toEbayErrorPayload } from "@/lib/marketplace/adapters/ebay/errors";
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
        marketplace: "ebay",
        environment: getEbayEnvironment(),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("EBAY_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }

    const { payload, status } = toEbayErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}

export const DELETE = POST;
