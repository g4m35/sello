import { describe, expect, it } from "vitest";

import { getEbayConfig, getEbayOAuthStateSecret } from "./config";
import {
  buildEbayAuthorizationUrl,
  createEbayOAuthStateCookie,
  parseEbayOAuthStateCookie,
} from "./oauth";

const config = getEbayConfig({
  EBAY_ENV: "sandbox",
  EBAY_CLIENT_ID: "client-id",
  EBAY_CLIENT_SECRET: "client-secret",
  EBAY_REDIRECT_URI_NAME: "redirect-uri-name",
  EBAY_MARKETPLACE_ID: "EBAY_US",
  EBAY_TOKEN_ENCRYPTION_KEY:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
});

describe("eBay OAuth helpers", () => {
  it("builds sandbox authorization URLs with the required scopes", () => {
    const url = buildEbayAuthorizationUrl(config, "state-1");

    expect(url.origin).toBe("https://auth.sandbox.ebay.com");
    expect(url.searchParams.get("client_id")).toBe("client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("redirect-uri-name");
    expect(url.searchParams.get("scope")).toContain("sell.inventory");
    expect(url.searchParams.get("scope")).toContain("sell.account");
    expect(url.searchParams.get("scope")).toContain("sell.fulfillment");
    expect(url.toString()).toContain("sell.inventory%20https");
    expect(url.toString()).not.toContain("sell.inventory+https");
  });

  it("builds production authorization URLs when EBAY_ENV is production", () => {
    const productionConfig = getEbayConfig({
      EBAY_ENV: "production",
      EBAY_CLIENT_ID: "owner-app-PRD-1234567890ab-cdef0123",
      EBAY_CLIENT_SECRET: "client-secret",
      EBAY_REDIRECT_URI_NAME: "owner-app-PRD-runame-xyz",
      EBAY_MARKETPLACE_ID: "EBAY_US",
      EBAY_TOKEN_ENCRYPTION_KEY:
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    });
    const url = buildEbayAuthorizationUrl(productionConfig, "state-1");

    expect(url.origin).toBe("https://auth.ebay.com");
    expect(url.pathname).toBe("/oauth2/authorize");
    expect(url.searchParams.get("client_id")).toBe(
      "owner-app-PRD-1234567890ab-cdef0123",
    );
    // redirect_uri must be the RuName from EBAY_REDIRECT_URI_NAME, never a
    // literal callback URL.
    expect(url.searchParams.get("redirect_uri")).toBe("owner-app-PRD-runame-xyz");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("scope")).toBe(
      "https://api.ebay.com/oauth/api_scope/sell.inventory https://api.ebay.com/oauth/api_scope/sell.account https://api.ebay.com/oauth/api_scope/sell.fulfillment",
    );
    // Spaces between scopes must encode as %20 (eBay rejects "+").
    expect(url.toString()).toContain("sell.inventory%20https");
    expect(url.toString()).not.toContain("+");
    expect(url.toString()).not.toContain("sandbox");
  });

  it("roundtrips signed state without exposing tokens", () => {
    const cookie = createEbayOAuthStateCookie({
      userId: "user-1",
      state: "state-1",
      secret: config.tokenEncryptionKey,
      now: new Date("2026-05-29T12:00:00.000Z"),
    });

    expect(cookie.value).not.toContain("token");
    expect(
      parseEbayOAuthStateCookie({
        cookieValue: cookie.value,
        expectedState: "state-1",
        secret: config.tokenEncryptionKey,
        now: new Date("2026-05-29T12:01:00.000Z"),
      }),
    ).toMatchObject({ userId: "user-1" });
  });

  it("signs and verifies state with a valid EBAY_OAUTH_STATE_SECRET", () => {
    const secret = getEbayOAuthStateSecret({
      EBAY_OAUTH_STATE_SECRET:
        "state-secret-state-secret-state-secret-0123456789",
    });
    const cookie = createEbayOAuthStateCookie({
      userId: "user-1",
      state: "state-1",
      secret,
      now: new Date("2026-05-29T12:00:00.000Z"),
    });

    expect(
      parseEbayOAuthStateCookie({
        cookieValue: cookie.value,
        expectedState: "state-1",
        secret,
        now: new Date("2026-05-29T12:01:00.000Z"),
      }),
    ).toMatchObject({ userId: "user-1" });
  });

  it("rejects mismatched state", () => {
    const cookie = createEbayOAuthStateCookie({
      userId: "user-1",
      state: "state-1",
      secret: config.tokenEncryptionKey,
      now: new Date("2026-05-29T12:00:00.000Z"),
    });

    expect(() =>
      parseEbayOAuthStateCookie({
        cookieValue: cookie.value,
        expectedState: "state-2",
        secret: config.tokenEncryptionKey,
        now: new Date("2026-05-29T12:01:00.000Z"),
      }),
    ).toThrow(expect.objectContaining({ code: "EBAY_OAUTH_STATE_INVALID" }));
  });
});
