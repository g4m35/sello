import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { stockxOAuthStateCookieName } from "@/lib/marketplace/adapters/stockx/oauth";

const mocks = vi.hoisted(() => ({
  requireSupabaseUserFromRequestOrCookies: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUserFromRequestOrCookies:
    mocks.requireSupabaseUserFromRequestOrCookies,
}));
vi.mock("@/lib/billing/account", () => ({
  getActiveAccount: vi
    .fn()
    .mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" }),
}));
vi.mock("@/lib/billing/connections", () => ({
  assertCanConnectMarketplace: vi.fn().mockResolvedValue(undefined),
  assertCanManageMarketplaceConnections: vi.fn().mockResolvedValue(undefined),
}));

import { GET } from "./route";

const ENV_KEYS = [
  "STOCKX_API_ENABLED",
  "STOCKX_CLIENT_ID",
  "STOCKX_CLIENT_SECRET",
  "STOCKX_REDIRECT_URI",
  "STOCKX_TOKEN_ENCRYPTION_KEY",
  "STOCKX_OAUTH_STATE_SECRET",
];

describe("StockX connect route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STOCKX_API_ENABLED = "true";
    process.env.STOCKX_CLIENT_ID = "stockx-client-id";
    process.env.STOCKX_CLIENT_SECRET = "stockx-client-secret";
    process.env.STOCKX_REDIRECT_URI = "https://sello.wtf/api/marketplaces/stockx/callback";
    process.env.STOCKX_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
    process.env.STOCKX_OAUTH_STATE_SECRET = "x".repeat(40);
  });

  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("requires an authenticated seller", async () => {
    mocks.requireSupabaseUserFromRequestOrCookies.mockRejectedValue(
      new AppError("Sign in.", 401),
    );
    const response = await GET(new Request("http://localhost/api/marketplaces/stockx/connect"));
    expect(response.status).toBe(401);
  });

  it("fails closed when the API switch is off", async () => {
    process.env.STOCKX_API_ENABLED = "false";
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({ id: "user-1" });
    const response = await GET(
      new Request("http://localhost/api/marketplaces/stockx/connect", {
        headers: { accept: "application/json" },
      }),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("STOCKX_NOT_ENABLED");
  });

  it("returns a StockX authorization URL and signed state cookie", async () => {
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({ id: "user-1" });
    const response = await GET(
      new Request("http://localhost/api/marketplaces/stockx/connect", {
        headers: { accept: "application/json" },
      }),
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.authorizationUrl).toContain("accounts.stockx.com/authorize");
    expect(payload.authorizationUrl).toContain("audience=gateway.stockx.com");
    expect(payload.authorizationUrl).not.toContain("stockx-client-secret");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(stockxOAuthStateCookieName);
    expect(cookie).toContain("HttpOnly");
  });
});
