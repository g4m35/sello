import { NextResponse } from "next/server";

import { getPrisma } from "@/lib/prisma";
import { getActiveAccount } from "@/lib/billing/account";
import { assertCanManageMarketplaceConnections } from "@/lib/billing/connections";
import { getEtsyConfig, getEtsyOAuthStateSecret } from "@/lib/marketplace/adapters/etsy/config";
import {
  EtsyIntegrationError,
  etsyErrorCodes,
  toEtsyErrorPayload,
} from "@/lib/marketplace/adapters/etsy/errors";
import {
  etsyOAuthStateCookieName,
  etsyUserIdFromAccessToken,
  exchangeAuthorizationCode,
  parseEtsyOAuthStateCookie,
} from "@/lib/marketplace/adapters/etsy/oauth";
import { encryptEtsyToken } from "@/lib/marketplace/adapters/etsy/token-crypto";
import { ETSY_ENVIRONMENT } from "@/lib/marketplace/adapters/etsy/types";
import { requireSupabaseUserFromRequestOrCookies } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const config = getEtsyConfig();
    const oauthState = parseEtsyOAuthStateCookie({
      cookieValue: getCookie(request, etsyOAuthStateCookieName),
      expectedState: state,
      secret: getEtsyOAuthStateSecret(),
    });

    // Bind the callback to the signed-in account: the user finishing the OAuth
    // round trip must be the user the signed state cookie was issued for, so a
    // captured state cannot attach another seller's shop.
    const user = await requireSupabaseUserFromRequestOrCookies(request);
    if (user.id !== oauthState.userId) {
      throw new EtsyIntegrationError(
        etsyErrorCodes.oauthStateInvalid,
        "The Etsy authorization does not match the signed-in account.",
        403,
      );
    }

    if (!code) {
      throw new EtsyIntegrationError(
        etsyErrorCodes.tokenExchangeFailed,
        "Etsy authorization code is missing.",
        400,
      );
    }

    const token = await exchangeAuthorizationCode(config, {
      code,
      codeVerifier: oauthState.codeVerifier,
    });
    if (!token.refresh_token) {
      throw new EtsyIntegrationError(
        etsyErrorCodes.tokenExchangeFailed,
        "Etsy did not return a refresh token.",
        502,
      );
    }

    const now = Date.now();
    const accessTokenEnc = encryptEtsyToken(token.access_token, config.tokenEncryptionKey);
    const refreshTokenEnc = encryptEtsyToken(token.refresh_token, config.tokenEncryptionKey);
    const accessTokenExpiresAt = new Date(now + token.expires_in * 1000);
    const externalUserId = etsyUserIdFromAccessToken(token.access_token);

    const prisma = getPrisma();
    const account = await getActiveAccount(user.id, prisma);
    await assertCanManageMarketplaceConnections(account, user.id, prisma);

    await prisma.marketplaceConnection.upsert({
      where: {
        accountId_marketplace_environment: {
          accountId: account.id,
          marketplace: "etsy",
          environment: ETSY_ENVIRONMENT,
        },
      },
      create: {
        userId: oauthState.userId,
        accountId: account.id,
        marketplace: "etsy",
        environment: ETSY_ENVIRONMENT,
        externalUserId,
        accessTokenEnc,
        refreshTokenEnc,
        accessTokenExpiresAt,
        refreshTokenExpiresAt: null,
        scopes: config.scopes,
      },
      update: {
        externalUserId,
        accessTokenEnc,
        refreshTokenEnc,
        accessTokenExpiresAt,
        scopes: config.scopes,
      },
    });

    const response = NextResponse.redirect(new URL("/settings/marketplaces", request.url));
    response.cookies.delete(etsyOAuthStateCookieName);
    return response;
  } catch (error) {
    const { payload, status } = toEtsyErrorPayload(error);
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
