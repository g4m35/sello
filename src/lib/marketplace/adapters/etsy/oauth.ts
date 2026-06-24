import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { EtsyIntegrationError, etsyErrorCodes } from "./errors";
import type { EtsyConfig, EtsyTokenResponse } from "./types";

export const etsyOAuthStateCookieName = "etsy_oauth_state";

// Etsy's OAuth endpoints are stable and environment-independent (Etsy has no
// sandbox). The application API base lives in config; these auth endpoints do not.
const authorizeUrl = "https://www.etsy.com/oauth/connect";
const tokenUrl = "https://api.etsy.com/v3/public/oauth/token";

type StatePayload = {
  userId: string;
  state: string;
  codeVerifier: string;
  expiresAt: number;
};

export function createRandomEtsyOAuthState() {
  return randomBytes(32).toString("base64url");
}

// PKCE (RFC 7636) — mandatory on every Etsy authorization flow.
export function createEtsyPkcePair() {
  const codeVerifier = randomBytes(48).toString("base64url");
  const codeChallenge = createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function buildEtsyAuthorizationUrl(
  config: EtsyConfig,
  args: { state: string; codeChallenge: string },
) {
  const url = new URL(authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", args.state);
  url.searchParams.set("code_challenge", args.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.search = url.search.replace(/\+/g, "%20");
  return url;
}

export function createEtsyOAuthStateCookie(args: {
  userId: string;
  state: string;
  codeVerifier: string;
  secret: string;
  now?: Date;
}) {
  const expiresAt = (args.now ?? new Date()).getTime() + 10 * 60 * 1000;
  const payload: StatePayload = {
    userId: args.userId,
    state: args.state,
    codeVerifier: args.codeVerifier,
    expiresAt,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = sign(encodedPayload, args.secret);

  return {
    name: etsyOAuthStateCookieName,
    value: `${encodedPayload}.${signature}`,
    maxAge: 10 * 60,
  };
}

export function parseEtsyOAuthStateCookie(args: {
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
    !payload.codeVerifier ||
    payload.expiresAt < (args.now ?? new Date()).getTime()
  ) {
    throw invalidState();
  }

  return payload;
}

export async function exchangeAuthorizationCode(
  config: EtsyConfig,
  args: { code: string; codeVerifier: string },
  fetchImpl: typeof fetch = fetch,
): Promise<EtsyTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    code: args.code,
    code_verifier: args.codeVerifier,
  });

  return postToken(body, fetchImpl, etsyErrorCodes.tokenExchangeFailed);
}

export async function refreshAccessToken(
  config: EtsyConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<EtsyTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: refreshToken,
  });

  return postToken(body, fetchImpl, etsyErrorCodes.tokenRefreshFailed);
}

// Etsy access tokens are prefixed with the authenticated user id ("12345.abc...").
export function etsyUserIdFromAccessToken(accessToken: string): string | null {
  const prefix = accessToken.split(".")[0];
  return prefix && /^\d+$/.test(prefix) ? prefix : null;
}

async function postToken(
  body: URLSearchParams,
  fetchImpl: typeof fetch,
  failureCode: typeof etsyErrorCodes.tokenExchangeFailed | typeof etsyErrorCodes.tokenRefreshFailed,
): Promise<EtsyTokenResponse> {
  const response = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    throw new EtsyIntegrationError(
      failureCode,
      "Etsy token request failed.",
      502,
      { status: response.status },
    );
  }

  const json = (await response.json()) as Partial<EtsyTokenResponse>;
  if (!json.access_token || typeof json.expires_in !== "number") {
    throw new EtsyIntegrationError(
      failureCode,
      "Etsy token response was missing required fields.",
      502,
    );
  }

  return json as EtsyTokenResponse;
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function invalidState() {
  return new EtsyIntegrationError(
    etsyErrorCodes.oauthStateInvalid,
    "The Etsy authorization state is invalid or expired.",
    400,
  );
}
