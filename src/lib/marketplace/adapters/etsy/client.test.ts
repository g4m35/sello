import { describe, expect, it, vi } from "vitest";

import { createEtsyClient, mapResponseError } from "./client";
import { EtsyIntegrationError, etsyErrorCodes, toEtsyErrorPayload } from "./errors";
import type { EtsyConfig } from "./types";

const config: EtsyConfig = {
  clientId: "etsy-keystring",
  clientSecret: null,
  redirectUri: "https://sello.wtf/cb",
  apiBaseUrl: "https://api.etsy.com/v3/application",
  scopes: ["listings_w"],
  tokenEncryptionKey: "a".repeat(64),
};

function clientWith(handler: (url: string, init?: RequestInit) => Response) {
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  const client = createEtsyClient({
    config,
    accessToken: "12345.secret-token",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
  return { client, fetchImpl };
}

describe("etsy client auth", () => {
  it("adds the x-api-key and Bearer headers internally", async () => {
    const { client, fetchImpl } = clientWith(
      () => new Response(JSON.stringify({ user_id: 12345 }), { status: 200 }),
    );
    await client.getMe();
    const [, init] = fetchImpl.mock.calls[0];
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("etsy-keystring");
    expect(headers["Authorization"]).toBe("Bearer 12345.secret-token");
  });

  it("targets the right path/method for createDraftListing", async () => {
    const { client, fetchImpl } = clientWith(
      () => new Response(JSON.stringify({ listing_id: 99 }), { status: 200 }),
    );
    const listing = await client.createDraftListing(777, { title: "x" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.etsy.com/v3/application/shops/777/listings");
    expect(init?.method).toBe("POST");
    expect(listing.listing_id).toBe(99);
  });

  it("activate/deactivate patch the listing state", async () => {
    const { client, fetchImpl } = clientWith(
      () => new Response(JSON.stringify({ listing_id: 5, state: "active" }), { status: 200 }),
    );
    await client.activateListing(1, 5);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.etsy.com/v3/application/shops/1/listings/5");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(init?.body as string)).toEqual({ state: "active" });
  });
});

describe("mapResponseError (sanitized)", () => {
  const cases: [number, string][] = [
    [401, etsyErrorCodes.reconnectRequired],
    [403, etsyErrorCodes.scopeMissing],
    [429, etsyErrorCodes.rateLimited],
    [500, etsyErrorCodes.apiFailed],
    [418, etsyErrorCodes.apiFailed],
  ];

  for (const [status, code] of cases) {
    it(`maps ${status} -> ${code}`, () => {
      const error = mapResponseError({ status, headers: { get: () => null } });
      expect(error).toBeInstanceOf(EtsyIntegrationError);
      expect(error.code).toBe(code);
    });
  }

  it("includes retry-after for 429 and never the raw body", () => {
    const error = mapResponseError({
      status: 429,
      headers: { get: (n: string) => (n === "retry-after" ? "30" : null) },
    });
    expect(error.details).toEqual({ retryAfterSeconds: 30 });
    const { payload } = toEtsyErrorPayload(error);
    expect(JSON.stringify(payload)).not.toContain("secret-token");
  });

  it("surfaces a sanitized payload from the client on a failing request", async () => {
    const { client } = clientWith(
      () => new Response("raw etsy 500 stack trace with token 12345.secret", { status: 500 }),
    );
    try {
      await client.getMe();
      throw new Error("expected throw");
    } catch (error) {
      const { payload } = toEtsyErrorPayload(error);
      expect(payload.code).toBe(etsyErrorCodes.apiFailed);
      expect(JSON.stringify(payload)).not.toContain("secret");
      expect(JSON.stringify(payload)).not.toContain("stack trace");
    }
  });
});
