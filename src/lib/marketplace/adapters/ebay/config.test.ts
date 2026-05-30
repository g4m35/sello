import { describe, expect, it } from "vitest";

import { getEbayConfig } from "./config";
import { ebayErrorCodes } from "./errors";

const completeEnv = {
  EBAY_ENV: "sandbox",
  EBAY_CLIENT_ID: "client-id",
  EBAY_CLIENT_SECRET: "client-secret",
  EBAY_REDIRECT_URI_NAME: "redirect-uri-name",
  EBAY_MARKETPLACE_ID: "EBAY_US",
  EBAY_TOKEN_ENCRYPTION_KEY:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
};

describe("getEbayConfig", () => {
  it("parses sandbox-only eBay config lazily", () => {
    expect(getEbayConfig(completeEnv)).toMatchObject({
      environment: "sandbox",
      marketplaceId: "EBAY_US",
      clientId: "client-id",
      redirectUriName: "redirect-uri-name",
    });
  });

  it("rejects production mode for now", () => {
    expect(() =>
      getEbayConfig({ ...completeEnv, EBAY_ENV: "production" }),
    ).toThrow(expect.objectContaining({ code: ebayErrorCodes.notConfigured }));
  });

  it("fails safely when required eBay env is missing", () => {
    expect(() =>
      getEbayConfig({ ...completeEnv, EBAY_CLIENT_SECRET: "" }),
    ).toThrow(expect.objectContaining({ code: ebayErrorCodes.notConfigured }));
  });
});
