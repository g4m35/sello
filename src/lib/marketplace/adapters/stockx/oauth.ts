import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { StockXIntegrationError, stockxErrorCodes } from "./errors";
import type { StockXConfig, StockXTokenResponse } from "./types";

export const stockxOAuthStateCookieName = "stockx_oauth_state";

type StatePayload = {
  userId: string;
  state: string;
  expiresAt: number;
};

export function createRandomStockXOAuthState() {
  return randomBytes(32).toString("base64url");
}

export function buildStockXAuthorizationUrl(
  config: StockXConfig,
  args: { state: string },
) {
  const url = new URL("/authorize", ensureTrailingSlash(config.authBaseUrl));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", args.state);
  // StockX's OAuth API is Auth0-backed; the gateway audience is required for
  // access tokens accepted by the StockX API.
  url.searchParams.set("audience", "gateway.stockx.com");
  url.search = url.search.replace(/\+/g, "%20");
  return url;
}

export function createStockXOAuthStateCookie(args: {
  userId: string;
  state: string;
  secret: string;
  now?: Date;
}) {
  const expiresAt = (args.now ?? new Date()).getTime() + 10 * 60 * 1000;
  const payload: StatePayload = {
    userId: args.userId,
    state: args.state,
    expiresAt,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encodedPayload, args.secret);

  return {
    name: stockxOAuthStateCookieName,
    value: `${encodedPayload}.${signature}`,
    maxAge: 10 * 60,
  };
}

export function parseStockXOAuthStateCookie(args: {
  cookieValue: string | null;
  expectedState: string | null;
  secret: string;
  now?: Date;
}): StatePayload {
  if (!args.cookieValue || !args.expectedState) {
    throw invalidState();
  }

  const [encodedPayload, signature] = args.cookieValue.split(".");
  if (!encodedPayload || !signature) {
    throw invalidState();
  }

  if (!safeEqual(signature, sign(encodedPayload, args.secret))) {
    throw invalidState();
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as StatePayload;
  } catch {
    throw invalidState();
  }

  if (
    payload.state !== args.expectedState ||
    payload.expiresAt < (args.now ?? new Date()).getTime()
  ) {
    throw invalidState();
  }

  return payload;
}

export async function exchangeStockXAuthorizationCode(
  config: StockXConfig,
  args: { code: string },
  fetchImpl: typeof fetch = fetch,
): Promise<StockXTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    code: args.code,
  });

  return postToken(config, body, fetchImpl, stockxErrorCodes.tokenExchangeFailed);
}

export async function refreshStockXAccessToken(
  config: StockXConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<StockXTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
  });

  return postToken(config, body, fetchImpl, stockxErrorCodes.tokenRefreshFailed);
}

export function stockxExternalUserIdFromToken(token: StockXTokenResponse): string | null {
  return jwtSubject(token.id_token) ?? jwtSubject(token.access_token);
}

async function postToken(
  config: StockXConfig,
  body: URLSearchParams,
  fetchImpl: typeof fetch,
  failureCode:
    | typeof stockxErrorCodes.tokenExchangeFailed
    | typeof stockxErrorCodes.tokenRefreshFailed,
): Promise<StockXTokenResponse> {
  const response = await fetchImpl(
    new URL("/oauth/token", ensureTrailingSlash(config.authBaseUrl)),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
  );

  if (!response.ok) {
    throw new StockXIntegrationError(
      failureCode,
      "StockX token request failed.",
      502,
      { status: response.status },
    );
  }

  const json = (await response.json()) as Partial<StockXTokenResponse>;
  if (!json.access_token || typeof json.expires_in !== "number") {
    throw new StockXIntegrationError(
      failureCode,
      "StockX token response was missing required fields.",
      502,
    );
  }

  return json as StockXTokenResponse;
}

function jwtSubject(token: string | undefined): string | null {
  if (!token) return null;
  const [, payloadRaw] = token.split(".");
  if (!payloadRaw) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(payloadRaw, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    return typeof payload.sub === "string" && payload.sub.trim()
      ? payload.sub
      : null;
  } catch {
    return null;
  }
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function invalidState() {
  return new StockXIntegrationError(
    stockxErrorCodes.oauthStateInvalid,
    "The StockX authorization state is invalid or expired.",
    400,
  );
}
