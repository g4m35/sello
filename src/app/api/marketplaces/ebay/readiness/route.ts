import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
import { getActiveAccount } from "@/lib/billing/account";
import { getPrisma } from "@/lib/prisma";
import {
  getEbayConfig,
  getEbayEnvironment,
} from "@/lib/marketplace/adapters/ebay/config";
import {
  EbaySandboxClient,
  getUsableEbayAccessToken,
  type EbayTokenPrismaLike,
} from "@/lib/marketplace/adapters/ebay/client";
import {
  EbayIntegrationError,
  ebayErrorCodes,
  toEbayErrorPayload,
} from "@/lib/marketplace/adapters/ebay/errors";
import {
  ebayReconnectRequiredResponse,
  getStoredEbayReadiness,
  refreshEbayReadiness,
  type EbayReadinessPrismaLike,
} from "@/lib/marketplace/adapters/ebay/readiness";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUserFromRequestOrCookies(request);
    const rawPrisma = getPrisma();
    const account = await getActiveAccount(user.id, rawPrisma);
    const prisma = rawPrisma as unknown as EbayReadinessPrismaLike & EbayTokenPrismaLike;
    const readiness = await getStoredEbayReadiness(
      prisma,
      user.id,
      getEbayEnvironment(),
      account.id,
    );
    return NextResponse.json(readiness);
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("EBAY_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }

    const { payload, status } = toEbayErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireSupabaseUserFromRequestOrCookies(request);
    const rawPrisma = getPrisma();
    const account = await getActiveAccount(user.id, rawPrisma);
    const prisma = rawPrisma as unknown as EbayReadinessPrismaLike & EbayTokenPrismaLike;
    const config = getEbayConfig();
    const connection = await prisma.marketplaceConnection.findUnique({
      where: {
        accountId_marketplace_environment: {
          accountId: account.id,
          marketplace: "ebay",
          environment: config.environment,
        },
      },
    });

    if (!connection) {
      const readiness = await getStoredEbayReadiness(
        prisma,
        user.id,
        config.environment,
        account.id,
      );
      return NextResponse.json(readiness, { status: 404 });
    }

    try {
      const accessToken = await getUsableEbayAccessToken(prisma, connection, config);
      const readiness = await refreshEbayReadiness(
        prisma,
        user.id,
        new EbaySandboxClient(
          accessToken,
          config.marketplaceId,
          fetch,
          config.environment,
        ),
        config.environment,
        account.id,
      );

      return NextResponse.json(readiness);
    } catch (error) {
      // Expired/revoked eBay tokens are an expected seller state, not a
      // server fault: answer 200 with a structured reconnect-required result.
      if (
        error instanceof EbayIntegrationError &&
        error.code === ebayErrorCodes.reconnectRequired
      ) {
        return NextResponse.json(
          ebayReconnectRequiredResponse(config.environment),
        );
      }
      throw error;
    }
  } catch (error) {
    if (error instanceof AppError && !(error as { code?: string }).code?.startsWith("EBAY_")) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: error.status });
    }

    const { payload, status } = toEbayErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}
