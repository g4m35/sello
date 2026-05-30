import { NextResponse } from "next/server";

import { getPrisma } from "@/lib/prisma";
import { getEbayConfig } from "@/lib/marketplace/adapters/ebay/config";
import {
  EbayIntegrationError,
  ebayErrorCodes,
  toEbayErrorPayload,
} from "@/lib/marketplace/adapters/ebay/errors";
import {
  ebayOAuthStateCookieName,
  exchangeAuthorizationCode,
  parseEbayOAuthStateCookie,
} from "@/lib/marketplace/adapters/ebay/oauth";
import { encryptEbayToken } from "@/lib/marketplace/adapters/ebay/token-crypto";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const config = getEbayConfig();
    const oauthState = parseEbayOAuthStateCookie({
      cookieValue: getCookie(request, ebayOAuthStateCookieName),
      expectedState: state,
      secret: config.tokenEncryptionKey,
    });

    if (!code) {
      throw new EbayIntegrationError(
        ebayErrorCodes.tokenExchangeFailed,
        "eBay sandbox authorization code is missing.",
        400,
      );
    }

    const token = await exchangeAuthorizationCode(config, code);
    if (!token.refresh_token) {
      throw new EbayIntegrationError(
        ebayErrorCodes.tokenExchangeFailed,
        "eBay sandbox did not return a refresh token.",
        502,
      );
    }

    const now = Date.now();
    await getPrisma().marketplaceConnection.upsert({
      where: {
        userId_marketplace_environment: {
          userId: oauthState.userId,
          marketplace: "ebay",
          environment: "sandbox",
        },
      },
      create: {
        userId: oauthState.userId,
        marketplace: "ebay",
        environment: "sandbox",
        accessTokenEnc: encryptEbayToken(
          token.access_token,
          config.tokenEncryptionKey,
        ),
        refreshTokenEnc: encryptEbayToken(
          token.refresh_token,
          config.tokenEncryptionKey,
        ),
        accessTokenExpiresAt: new Date(now + token.expires_in * 1000),
        refreshTokenExpiresAt: token.refresh_token_expires_in
          ? new Date(now + token.refresh_token_expires_in * 1000)
          : null,
        scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [],
      },
      update: {
        accessTokenEnc: encryptEbayToken(
          token.access_token,
          config.tokenEncryptionKey,
        ),
        refreshTokenEnc: encryptEbayToken(
          token.refresh_token,
          config.tokenEncryptionKey,
        ),
        accessTokenExpiresAt: new Date(now + token.expires_in * 1000),
        refreshTokenExpiresAt: token.refresh_token_expires_in
          ? new Date(now + token.refresh_token_expires_in * 1000)
          : null,
        scopes: token.scope?.split(/\s+/).filter(Boolean) ?? [],
      },
    });

    const response = NextResponse.redirect(
      new URL("/settings/marketplaces", request.url),
    );
    response.cookies.delete(ebayOAuthStateCookieName);
    return response;
  } catch (error) {
    const { payload, status } = toEbayErrorPayload(error);
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
