import { NextResponse } from "next/server";

import { getActiveAccount } from "@/lib/billing/account";
import { assertCanManageMarketplaceConnections } from "@/lib/billing/connections";
import { getPrisma } from "@/lib/prisma";
import {
  getStockXOAuthConfig,
  getStockXOAuthStateSecret,
} from "@/lib/marketplace/adapters/stockx/config";
import {
  StockXIntegrationError,
  stockxErrorCodes,
  toStockXErrorPayload,
} from "@/lib/marketplace/adapters/stockx/errors";
import {
  exchangeStockXAuthorizationCode,
  parseStockXOAuthStateCookie,
  stockxExternalUserIdFromToken,
  stockxOAuthStateCookieName,
} from "@/lib/marketplace/adapters/stockx/oauth";
import { encryptStockXToken } from "@/lib/marketplace/adapters/stockx/token-crypto";
import { STOCKX_ENVIRONMENT } from "@/lib/marketplace/adapters/stockx/types";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const config = getStockXOAuthConfig();
    const oauthState = parseStockXOAuthStateCookie({
      cookieValue: getCookie(request, stockxOAuthStateCookieName),
      expectedState: state,
      secret: getStockXOAuthStateSecret(),
    });

    const user = await requireSupabaseUserFromRequestOrCookies(request);
    if (user.id !== oauthState.userId) {
      throw new StockXIntegrationError(
        stockxErrorCodes.oauthStateInvalid,
        "The StockX authorization does not match the signed-in account.",
        403,
      );
    }

    if (!code) {
      throw new StockXIntegrationError(
        stockxErrorCodes.tokenExchangeFailed,
        "StockX authorization code is missing.",
        400,
      );
    }

    const token = await exchangeStockXAuthorizationCode(config, { code });
    const now = Date.now();
    const accessTokenEnc = encryptStockXToken(token.access_token, config.tokenEncryptionKey);
    const refreshTokenEnc = encryptStockXToken(token.refresh_token ?? "", config.tokenEncryptionKey);
    const accessTokenExpiresAt = new Date(now + token.expires_in * 1000);
    const externalUserId = stockxExternalUserIdFromToken(token);
    const scopes = token.scope
      ? token.scope.split(/\s+/).map((scope) => scope.trim()).filter(Boolean)
      : config.scopes;

    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    await assertCanManageMarketplaceConnections(account, user.id, prisma);

    await prisma.marketplaceConnection.upsert({
      where: {
        accountId_marketplace_environment: {
          accountId: account.id,
          marketplace: "stockx",
          environment: STOCKX_ENVIRONMENT,
        },
      },
      create: {
        userId: oauthState.userId,
        accountId: account.id,
        marketplace: "stockx",
        environment: STOCKX_ENVIRONMENT,
        externalUserId,
        accessTokenEnc,
        refreshTokenEnc,
        accessTokenExpiresAt,
        refreshTokenExpiresAt: null,
        scopes,
      },
      update: {
        externalUserId,
        accessTokenEnc,
        refreshTokenEnc,
        accessTokenExpiresAt,
        scopes,
      },
    });

    const response = NextResponse.redirect(new URL("/settings/marketplaces", request.url));
    response.cookies.delete(stockxOAuthStateCookieName);
    return response;
  } catch (error) {
    const { payload, status } = toStockXErrorPayload(error);
    return NextResponse.json({ error: payload }, { status });
  }
}

function getCookie(request: Request, name: string) {
  const cookies = request.headers.get("cookie") ?? "";
  return (
    cookies
      .split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${name}=`))
      ?.slice(name.length + 1) ?? null
  );
}
