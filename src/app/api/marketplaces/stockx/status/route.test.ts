import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabaseUserFromRequestOrCookies: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUserFromRequestOrCookies:
    mocks.requireSupabaseUserFromRequestOrCookies,
}));
vi.mock("@/lib/billing/account", () => ({
  getActiveAccount: vi.fn().mockResolvedValue({ id: "acc-1", ownerUserId: "user-1" }),
}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({ marketplaceConnection: { findUnique: mocks.findUnique } }),
}));

import { GET } from "./route";

const stockxOauthEnv = {
  STOCKX_API_ENABLED: "true",
  STOCKX_CLIENT_ID: "client-id",
  STOCKX_CLIENT_SECRET: "client-secret",
  STOCKX_REDIRECT_URI: "https://sello.wtf/api/marketplaces/stockx/callback",
  STOCKX_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  STOCKX_OAUTH_STATE_SECRET: "x".repeat(40),
};

describe("StockX status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({ id: "user-1" });
    mocks.findUnique.mockResolvedValue({ id: "conn-1" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports fail-closed defaults without touching the DB", async () => {
    const response = await GET(new Request("http://localhost/api/marketplaces/stockx/status"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.apiEnabled).toBe(false);
    expect(payload.marketDataEnabled).toBe(false);
    expect(payload.listingEnabled).toBe(false);
    expect(payload.connected).toBe(false);
    expect(payload.capabilities.catalogSearch).toBe(false);
    expect(payload.capabilities.productMatching).toBe(true);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it("checks the active account connection only when the API is enabled", async () => {
    for (const [key, value] of Object.entries(stockxOauthEnv)) vi.stubEnv(key, value);
    const response = await GET(new Request("http://localhost/api/marketplaces/stockx/status"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.connected).toBe(true);
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: {
        accountId_marketplace_environment: {
          accountId: "acc-1",
          marketplace: "stockx",
          environment: "production",
        },
      },
      select: { id: true },
    });
  });

  it("does not check connection or expose catalog capability when credentials are incomplete", async () => {
    vi.stubEnv("STOCKX_API_ENABLED", "true");

    const response = await GET(new Request("http://localhost/api/marketplaces/stockx/status"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.apiEnabled).toBe(true);
    expect(payload.connected).toBe(false);
    expect(payload.capabilities.connect).toBe(false);
    expect(payload.capabilities.catalogSearch).toBe(false);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });
});
