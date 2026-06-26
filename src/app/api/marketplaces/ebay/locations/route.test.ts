import { beforeEach, describe, expect, it, vi } from "vitest";

import { encryptEbayToken } from "@/lib/marketplace/adapters/ebay/token-crypto";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUserFromRequestOrCookies: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/billing/account", () => ({
  getActiveAccount: vi.fn().mockResolvedValue({
    id: "acc-1",
    ownerUserId: "11111111-1111-4111-8111-111111111111",
    plan: "free",
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUserFromRequestOrCookies: mocks.requireSupabaseUserFromRequestOrCookies,
}));

import { POST } from "./route";

const validBody = {
  name: "Default location",
  addressLine1: "123 Main St",
  city: "San Francisco",
  stateOrProvince: "CA",
  postalCode: "94103",
  country: "US",
};

function locationRequest(body: unknown) {
  return new Request("http://localhost/api/marketplaces/ebay/locations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockConnectedPrisma(key: string) {
  mocks.getPrisma.mockReturnValue({
    marketplaceConnection: {
      findUnique: vi.fn().mockResolvedValue({
        id: "connection-1",
        accessTokenEnc: encryptEbayToken("raw-access-token", key),
        refreshTokenEnc: encryptEbayToken("raw-refresh-token", key),
        accessTokenExpiresAt: new Date(Date.now() + 120_000),
      }),
      update: vi.fn(),
    },
  });
}

describe("eBay locations route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    process.env.EBAY_ENV = "production";
    process.env.EBAY_CLIENT_ID = "client-id";
    process.env.EBAY_CLIENT_SECRET = "client-secret";
    process.env.EBAY_REDIRECT_URI_NAME = "redirect-name";
    process.env.EBAY_MARKETPLACE_ID = "EBAY_US";
    process.env.EBAY_TOKEN_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("creates the default location via the production eBay endpoint", async () => {
    const key = process.env.EBAY_TOKEN_ENCRYPTION_KEY!;
    mockConnectedPrisma(key);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const response = await POST(locationRequest(validBody));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      ok: true,
      merchantLocationKey: "sello-default-location",
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe(
      "https://api.ebay.com/sell/inventory/v1/location/sello-default-location",
    );
    expect(init?.method).toBe("POST");
    const sent = JSON.parse(String(init?.body));
    expect(sent).toMatchObject({
      name: "Default location",
      merchantLocationStatus: "ENABLED",
      locationTypes: ["WAREHOUSE"],
      location: {
        address: {
          addressLine1: "123 Main St",
          city: "San Francisco",
          stateOrProvince: "CA",
          postalCode: "94103",
          country: "US",
        },
      },
    });
  });

  it("rejects an invalid address before calling eBay", async () => {
    const key = process.env.EBAY_TOKEN_ENCRYPTION_KEY!;
    mockConnectedPrisma(key);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await POST(
      locationRequest({ ...validBody, postalCode: "not-a-zip", city: "" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain("City is required.");
    expect(payload.error).toContain("ZIP");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces eBay 4xx rejections as actionable errors, not 502", async () => {
    const key = process.env.EBAY_TOKEN_ENCRYPTION_KEY!;
    mockConnectedPrisma(key);
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errors: [
            { errorId: 25802, longMessage: "Input error. Invalid postal code for the specified country." },
          ],
        }),
        { status: 400 },
      ),
    );

    const response = await POST(locationRequest(validBody));
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload.error.code).toBe("EBAY_LOCATION_CREATE_FAILED");
    expect(payload.error.message).toContain("Invalid postal code");
  });

  it("requires an eBay connection", async () => {
    mocks.getPrisma.mockReturnValue({
      marketplaceConnection: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await POST(locationRequest(validBody));
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload.error.code).toBe("EBAY_NOT_CONNECTED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects non-US countries", async () => {
    const key = process.env.EBAY_TOKEN_ENCRYPTION_KEY!;
    mockConnectedPrisma(key);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await POST(locationRequest({ ...validBody, country: "DE" }));

    expect(response.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
