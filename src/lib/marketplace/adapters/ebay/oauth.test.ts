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
