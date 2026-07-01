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
    vi.stubEnv("STOCKX_API_ENABLED", "true");
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
});
