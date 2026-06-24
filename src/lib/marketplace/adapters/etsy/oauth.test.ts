import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { EtsyIntegrationError, etsyErrorCodes } from "./errors";
import {
  buildEtsyAuthorizationUrl,
  createEtsyOAuthStateCookie,
  createEtsyPkcePair,
  exchangeAuthorizationCode,
  etsyUserIdFromAccessToken,
  parseEtsyOAuthStateCookie,
  refreshAccessToken,
} from "./oauth";
import type { EtsyConfig } from "./types";

const config: EtsyConfig = {
  clientId: "etsy-keystring",
  clientSecret: null,
  redirectUri: "https://sello.wtf/api/marketplaces/etsy/callback",
  apiBaseUrl: "https://api.etsy.com/v3/application",
  scopes: ["listings_r", "listings_w"],
  tokenEncryptionKey: "a".repeat(64),
};

const secret = "x".repeat(40);

describe("etsy PKCE", () => {
  it("derives an S256 challenge from the verifier", () => {
    const { codeVerifier, codeChallenge } = createEtsyPkcePair();
    const expected = createHash("sha256").update(codeVerifier).digest("base64url");
    expect(codeChallenge).toBe(expected);
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
  });
});

describe("buildEtsyAuthorizationUrl", () => {
  it("includes PKCE, scopes, state, and redirect", () => {
    const url = buildEtsyAuthorizationUrl(config, {
      state: "state123",
      codeChallenge: "challenge123",
    });
    expect(url.origin + url.pathname).toBe("https://www.etsy.com/oauth/connect");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("etsy-keystring");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("scope")).toBe("listings_r listings_w");
    expect(url.searchParams.get("state")).toBe("state123");
    expect(url.searchParams.get("code_challenge")).toBe("challenge123");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("etsy oauth state cookie", () => {
  it("round-trips userId/state/codeVerifier", () => {
    const cookie = createEtsyOAuthStateCookie({
      userId: "user-1",
      state: "state123",
      codeVerifier: "verifier123",
      secret,
    });
    const parsed = parseEtsyOAuthStateCookie({
      cookieValue: cookie.value,
      expectedState: "state123",
      secret,
    });
    expect(parsed.userId).toBe("user-1");
    expect(parsed.codeVerifier).toBe("verifier123");
  });

  it("rejects a tampered signature", () => {
    const cookie = createEtsyOAuthStateCookie({
      userId: "user-1",
      state: "s",
      codeVerifier: "v",
      secret,
    });
    expect(() =>
      parseEtsyOAuthStateCookie({
        cookieValue: `${cookie.value}tamper`,
        expectedState: "s",
        secret,
      }),
    ).toThrow(EtsyIntegrationError);
  });

  it("rejects a state mismatch", () => {
    const cookie = createEtsyOAuthStateCookie({
      userId: "user-1",
      state: "s",
      codeVerifier: "v",
      secret,
    });
    expect(() =>
      parseEtsyOAuthStateCookie({
        cookieValue: cookie.value,
        expectedState: "different",
        secret,
      }),
    ).toThrow(EtsyIntegrationError);
  });

  it("rejects an expired cookie", () => {
    const cookie = createEtsyOAuthStateCookie({
      userId: "user-1",
      state: "s",
      codeVerifier: "v",
      secret,
      now: new Date(1000),
    });
    expect(() =>
      parseEtsyOAuthStateCookie({
        cookieValue: cookie.value,
        expectedState: "s",
        secret,
        now: new Date(1000 + 11 * 60 * 1000),
      }),
    ).toThrow(EtsyIntegrationError);
  });
});

describe("token exchange / refresh", () => {
  it("exchanges an authorization code with the code_verifier", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = new URLSearchParams(init?.body as string);
      expect(body.get("grant_type")).toBe("authorization_code");
      expect(body.get("code_verifier")).toBe("verifier123");
      expect(body.get("client_id")).toBe("etsy-keystring");
      return new Response(
        JSON.stringify({ access_token: "12345.tok", refresh_token: "r", expires_in: 3600 }),
        { status: 200 },
      );
    });

    const token = await exchangeAuthorizationCode(
      config,
      { code: "auth-code", codeVerifier: "verifier123" },
      fetchImpl as unknown as typeof fetch,
    );
    expect(token.access_token).toBe("12345.tok");
  });

  it("maps a failed exchange to tokenExchangeFailed without leaking the body", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("raw etsy error detail", { status: 400 }),
    );
    try {
      await exchangeAuthorizationCode(
        config,
        { code: "bad", codeVerifier: "v" },
        fetchImpl as unknown as typeof fetch,
      );
      throw new Error("expected throw");
    } catch (error) {
      expect((error as EtsyIntegrationError).code).toBe(
        etsyErrorCodes.tokenExchangeFailed,
      );
      expect((error as EtsyIntegrationError).message).not.toContain("raw etsy error");
    }
  });

  it("refreshes with grant_type=refresh_token", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = new URLSearchParams(init?.body as string);
      expect(body.get("grant_type")).toBe("refresh_token");
      expect(body.get("refresh_token")).toBe("old-refresh");
      return new Response(
        JSON.stringify({ access_token: "12345.new", refresh_token: "r2", expires_in: 3600 }),
        { status: 200 },
      );
    });
    const token = await refreshAccessToken(
      config,
      "old-refresh",
      fetchImpl as unknown as typeof fetch,
    );
    expect(token.access_token).toBe("12345.new");
  });
});

describe("etsyUserIdFromAccessToken", () => {
  it("extracts the numeric user id prefix", () => {
    expect(etsyUserIdFromAccessToken("987654.abcdef")).toBe("987654");
    expect(etsyUserIdFromAccessToken("noprefix")).toBeNull();
  });
});
