import { afterEach, describe, expect, it, vi } from "vitest";
import { EbaySandboxClient, getUsableEbayAccessToken } from "./ebay/client";
import { encryptEbayToken } from "./ebay/token-crypto";
import { EBAY_FULFILLMENT_SCOPE, type EbayConfig } from "./ebay/types";
import { deactivateStockXListing, fetchStockXListingStatus } from "./stockx/client";
import { refreshStockXAccessToken } from "./stockx/oauth";
import type { StockXConfig } from "./stockx/types";

const key = "a".repeat(64);
const ebayConfig: EbayConfig = {
  environment: "sandbox", clientId: "client", clientSecret: "secret",
  redirectUriName: "redirect", marketplaceId: "EBAY_US", tokenEncryptionKey: key,
};
const stockxConfig: StockXConfig = {
  clientId: "client", clientSecret: "secret", redirectUri: "https://example.test/callback",
  apiBaseUrl: "https://api.stockx.com", authBaseUrl: "https://accounts.stockx.com",
  apiKey: "test-key", scopes: ["offline_access"], tokenEncryptionKey: key,
};
const ebay = (fetchImpl: typeof fetch) => new EbaySandboxClient("test-token", "EBAY_US", fetchImpl, "sandbox", [EBAY_FULFILLMENT_SCOPE]);
const calls: Array<{ name: string; run(fetchImpl: typeof fetch): Promise<unknown> }> = [
  { name: "eBay sale polling", run: fetchImpl => ebay(fetchImpl).getOrdersModifiedSince(new Date(0)) },
  { name: "eBay token refresh", run: fetchImpl => getUsableEbayAccessToken({ marketplaceConnection: {
    update: async () => { throw new Error("An aborted refresh must not write credentials"); },
  } }, {
    id: "connection", accessTokenEnc: encryptEbayToken("test-access", key), refreshTokenEnc: encryptEbayToken("test-refresh", key), accessTokenExpiresAt: new Date(0),
  }, ebayConfig, fetchImpl) },
  { name: "StockX sale status", run: fetchImpl => fetchStockXListingStatus(stockxConfig, "test-token", "listing", fetchImpl) },
  { name: "StockX token refresh", run: fetchImpl => refreshStockXAccessToken(stockxConfig, "test-refresh", fetchImpl) },
  { name: "eBay delist mutation", run: fetchImpl => ebay(fetchImpl).withdrawOffer("offer") },
  { name: "StockX delist mutation", run: fetchImpl => deactivateStockXListing(stockxConfig, "test-token", "listing", fetchImpl) },
];

afterEach(() => vi.restoreAllMocks());

describe.each(calls)("$name deadline", ({ run }) => {
  it.each(["headers", "body"])("aborts a stalled %s without retrying the request", async (stage) => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    const fetchImpl = vi.fn<typeof fetch>(async (_url, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error("Missing request deadline");
      if (stage === "headers") {
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      // Model native fetch: its abort signal also terminates body consumption
      // after response headers have already arrived.
      const body = new ReadableStream({ start(stream) {
        signal.addEventListener("abort", () => stream.error(signal.reason), { once: true });
      } });
      return new Response(body);
    });
    const pending = run(fetchImpl);
    const rejected = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
    await rejected;
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
