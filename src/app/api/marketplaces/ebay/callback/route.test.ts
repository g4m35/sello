import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createEbayOAuthStateCookie,
  ebayOAuthStateCookieName,
} from "@/lib/marketplace/adapters/ebay/oauth";
import { decryptEbayToken } from "@/lib/marketplace/adapters/ebay/token-crypto";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

import { GET } from "./route";

const key =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("eBay callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EBAY_ENV = "sandbox";
    process.env.EBAY_CLIENT_ID = "client-id";
    process.env.EBAY_CLIENT_SECRET = "client-secret";
    process.env.EBAY_REDIRECT_URI_NAME = "redirect-name";
    process.env.EBAY_MARKETPLACE_ID = "EBAY_US";
    process.env.EBAY_TOKEN_ENCRYPTION_KEY = key;
  });

  it("rejects missing state", async () => {
    const response = await GET(
      new Request("http://localhost/api/marketplaces/ebay/callback?code=abc"),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("EBAY_OAUTH_STATE_INVALID");
  });

  it("rejects wrong state", async () => {
    const cookie = createEbayOAuthStateCookie({
      userId: "11111111-1111-4111-8111-111111111111",
      state: "right-state",
      secret: key,
    });

    const response = await GET(
      new Request(
        "http://localhost/api/marketplaces/ebay/callback?code=abc&state=wrong-state",
        {
          headers: {
            cookie: `${ebayOAuthStateCookieName}=${cookie.value}`,
          },
        },
      ),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("EBAY_OAUTH_STATE_INVALID");
  });

  it("stores encrypted tokens and redirects without exposing raw tokens", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "connection-1" });
    mocks.getPrisma.mockReturnValue({ marketplaceConnection: { upsert } });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "raw-access-token",
          refresh_token: "raw-refresh-token",
          expires_in: 7200,
          refresh_token_expires_in: 86400,
          scope: "scope-a scope-b",
        }),
        { status: 200 },
      ),
    );
    const cookie = createEbayOAuthStateCookie({
      userId: "11111111-1111-4111-8111-111111111111",
      state: "state-1",
      secret: key,
    });

    const response = await GET(
      new Request(
        "http://localhost/api/marketplaces/ebay/callback?code=abc&state=state-1",
        {
          headers: {
            cookie: `${ebayOAuthStateCookieName}=${cookie.value}`,
          },
        },
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/settings/marketplaces",
    );
    expect(JSON.stringify(upsert.mock.calls)).not.toContain("raw-access-token");
    expect(JSON.stringify(upsert.mock.calls)).not.toContain("raw-refresh-token");
    const data = upsert.mock.calls[0][0].create;
    expect(decryptEbayToken(data.accessTokenEnc, key)).toBe("raw-access-token");
    expect(decryptEbayToken(data.refreshTokenEnc, key)).toBe("raw-refresh-token");
  });
});
