import { NextResponse } from "next/server";

import { AppError, getErrorMessage } from "@/lib/errors";
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
import { toEbayErrorPayload } from "@/lib/marketplace/adapters/ebay/errors";
import {
  getStoredEbayReadiness,
  refreshEbayReadiness,
  type EbayReadinessPrismaLike,
} from "@/lib/marketplace/adapters/ebay/readiness";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireSupabaseUserFromRequestOrCookies(request);
    const readiness = await getStoredEbayReadiness(
      getEbayPrisma(),
      user.id,
      getEbayEnvironment(),
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
    const prisma = getEbayPrisma();
    const config = getEbayConfig();
    const connection = await prisma.marketplaceConnection.findUnique({
      where: {
        userId_marketplace_environment: {
          userId: user.id,
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
      );
      return NextResponse.json(readiness, { status: 404 });
    }

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

function getEbayPrisma() {
  return getPrisma() as unknown as EbayReadinessPrismaLike & EbayTokenPrismaLike;
}
