import { describe, expect, it, vi } from "vitest";

import type { StockXConfig } from "./types";
import {
  buildStockXAuthorizationUrl,
  createStockXOAuthStateCookie,
  exchangeStockXAuthorizationCode,
  parseStockXOAuthStateCookie,
  stockxExternalUserIdFromToken,
} from "./oauth";
import { StockXIntegrationError } from "./errors";

const config: StockXConfig = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://sello.wtf/api/marketplaces/stockx/callback",
  apiBaseUrl: "https://api.stockx.com/v2",
  authBaseUrl: "https://accounts.stockx.com",
  apiKey: "api-key",
  scopes: ["offline_access", "openid"],
  tokenEncryptionKey: "a".repeat(64),
};

describe("StockX OAuth URL and state", () => {
  it("builds a StockX authorization URL without leaking secrets", () => {
    const url = buildStockXAuthorizationUrl(config, { state: "state-1" });
    expect(url.toString()).toContain("https://accounts.stockx.com/authorize");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("audience")).toBe("gateway.stockx.com");
    expect(url.toString()).not.toContain("client-secret");
    expect(url.toString()).not.toContain("api-key");
  });

  it("round-trips and validates the signed state cookie", () => {
    const cookie = createStockXOAuthStateCookie({
      userId: "user-1",
      state: "state-1",
      secret: "x".repeat(40),
      now: new Date("2026-07-01T00:00:00.000Z"),
    });
    const payload = parseStockXOAuthStateCookie({
      cookieValue: cookie.value,
      expectedState: "state-1",
      secret: "x".repeat(40),
      now: new Date("2026-07-01T00:01:00.000Z"),
    });
    expect(payload.userId).toBe("user-1");
  });

  it("rejects state tampering and expiry", () => {
    const cookie = createStockXOAuthStateCookie({
      userId: "user-1",
      state: "state-1",
      secret: "x".repeat(40),
      now: new Date("2026-07-01T00:00:00.000Z"),
    });
    expect(() =>
      parseStockXOAuthStateCookie({
        cookieValue: cookie.value,
        expectedState: "other",
        secret: "x".repeat(40),
      }),
    ).toThrow(StockXIntegrationError);
    expect(() =>
      parseStockXOAuthStateCookie({
        cookieValue: cookie.value,
        expectedState: "state-1",
        secret: "x".repeat(40),
        now: new Date("2026-07-01T00:11:00.000Z"),
      }),
    ).toThrow(StockXIntegrationError);
  });
});

describe("StockX token exchange", () => {
  it("posts credentials to the token endpoint and returns the token response", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            access_token: "access-token",
            refresh_token: "refresh-token",
            expires_in: 3600,
          }),
          { status: 200 },
        ),
    );

    const token = await exchangeStockXAuthorizationCode(
      config,
      { code: "auth-code" },
      fetchImpl as unknown as typeof fetch,
    );

    expect(token.access_token).toBe("access-token");
    const firstCall = fetchImpl.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit | undefined,
    ];
    const [url, init] = firstCall;
    expect(String(url)).toBe("https://accounts.stockx.com/oauth/token");
    const body = init?.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("client_secret")).toBe("client-secret");
  });
});

describe("stockxExternalUserIdFromToken", () => {
  it("extracts a JWT subject when present", () => {
    const payload = Buffer.from(JSON.stringify({ sub: "stockx|user-1" })).toString("base64url");
    expect(
      stockxExternalUserIdFromToken({
        access_token: `x.${payload}.y`,
        expires_in: 3600,
      }),
    ).toBe("stockx|user-1");
  });
});
