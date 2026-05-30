import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { ebayOAuthStateCookieName } from "@/lib/marketplace/adapters/ebay/oauth";

const mocks = vi.hoisted(() => ({
  requireSupabaseUser: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));

import { GET } from "./route";

describe("eBay connect route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EBAY_ENV = "sandbox";
    process.env.EBAY_CLIENT_ID = "client-id";
    process.env.EBAY_CLIENT_SECRET = "client-secret";
    process.env.EBAY_REDIRECT_URI_NAME = "redirect-name";
    process.env.EBAY_MARKETPLACE_ID = "EBAY_US";
    process.env.EBAY_TOKEN_ENCRYPTION_KEY =
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    process.env.EBAY_OAUTH_STATE_SECRET =
      "state-secret-state-secret-state-secret-0123456789";
  });

  it("requires an authenticated seller", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(new AppError("Sign in.", 401));

    const response = await GET(new Request("http://localhost/api/marketplaces/ebay/connect"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in." });
  });

  it("returns a sandbox authorization URL and an httpOnly state cookie", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });

    const response = await GET(
      new Request("http://localhost/api/marketplaces/ebay/connect", {
        headers: { accept: "application/json" },
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.authorizationUrl).toContain("auth.sandbox.ebay.com");
    expect(payload.authorizationUrl).not.toContain("client-secret");
    expect(response.headers.get("set-cookie")).toContain(ebayOAuthStateCookieName);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });
});
