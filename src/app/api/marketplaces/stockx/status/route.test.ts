import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabaseUserFromRequestOrCookies: vi.fn(),
  findUnique: vi.fn(),
  probeStockXConnectionReadiness: vi.fn(),
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
vi.mock("@/lib/marketplace/adapters/stockx/connection-readiness", async () => {
  const actual = await vi.importActual<
    typeof import("@/lib/marketplace/adapters/stockx/connection-readiness")
  >("@/lib/marketplace/adapters/stockx/connection-readiness");
  return {
    ...actual,
    probeStockXConnectionReadiness: mocks.probeStockXConnectionReadiness,
  };
});

import { GET } from "./route";
import { connectionReadiness } from "@/lib/marketplace/adapters/stockx/connection-readiness";

const stockxOauthEnv = {
  STOCKX_API_ENABLED: "true",
  STOCKX_CLIENT_ID: "client-id",
  STOCKX_CLIENT_SECRET: "client-secret",
  STOCKX_REDIRECT_URI: "https://sello.wtf/api/marketplaces/stockx/callback",
  STOCKX_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  STOCKX_OAUTH_STATE_SECRET: "x".repeat(40),
  STOCKX_API_KEY: "api-key",
};

describe("StockX status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({ id: "user-1" });
    mocks.findUnique.mockResolvedValue({ id: "conn-1" });
    mocks.probeStockXConnectionReadiness.mockResolvedValue(connectionReadiness("ready"));
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
    expect(payload.setupState).toBe("not_connected");
    expect(payload.statusLabel).toBe("Not connected");
    expect(payload.capabilities.catalogSearch).toBe(false);
    expect(payload.capabilities.productMatching).toBe(true);
    expect(mocks.probeStockXConnectionReadiness).not.toHaveBeenCalled();
  });

  it("probes readiness when OAuth is configured", async () => {
    for (const [key, value] of Object.entries(stockxOauthEnv)) vi.stubEnv(key, value);
    mocks.probeStockXConnectionReadiness.mockResolvedValue(
      connectionReadiness("seller_profile_incomplete"),
    );

    const response = await GET(new Request("http://localhost/api/marketplaces/stockx/status"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.connected).toBe(true);
    expect(payload.setupState).toBe("seller_profile_incomplete");
    expect(payload.statusLabel).toBe("Connected · finish setup");
    expect(payload.nextStep?.externalUrl).toContain("stockx.com");
    expect(mocks.probeStockXConnectionReadiness).toHaveBeenCalled();
  });

  it("skips probe when probe=0", async () => {
    for (const [key, value] of Object.entries(stockxOauthEnv)) vi.stubEnv(key, value);

    const response = await GET(
      new Request("http://localhost/api/marketplaces/stockx/status?probe=0"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.connected).toBe(true);
    expect(mocks.probeStockXConnectionReadiness).not.toHaveBeenCalled();
    expect(mocks.findUnique).toHaveBeenCalled();
  });

  it("does not check connection when credentials are incomplete", async () => {
    vi.stubEnv("STOCKX_API_ENABLED", "true");

    const response = await GET(new Request("http://localhost/api/marketplaces/stockx/status"));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.apiEnabled).toBe(true);
    expect(payload.connected).toBe(false);
    expect(payload.capabilities.connect).toBe(false);
    expect(mocks.probeStockXConnectionReadiness).not.toHaveBeenCalled();
  });
});
