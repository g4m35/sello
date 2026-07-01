import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabaseUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));

import { POST } from "./route";

const stockxApiEnv = {
  STOCKX_API_ENABLED: "true",
  STOCKX_LISTING_ENABLED: "true",
  STOCKX_CLIENT_ID: "client-id",
  STOCKX_CLIENT_SECRET: "client-secret",
  STOCKX_API_KEY: "api-key",
  STOCKX_REDIRECT_URI: "https://sello.wtf/api/marketplaces/stockx/callback",
  STOCKX_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  STOCKX_OAUTH_STATE_SECRET: "x".repeat(40),
};

describe("StockX publish placeholder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed by default and performs no live listing creation", async () => {
    const response = await POST(
      new Request("http://localhost/api/marketplaces/stockx/publish", { method: "POST" }),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("STOCKX_LISTING_NOT_ENABLED");
    expect(mocks.requireSupabaseUser).not.toHaveBeenCalled();
  });

  it("still requires future readiness gates even if the listing flag is enabled", async () => {
    for (const [key, value] of Object.entries(stockxApiEnv)) vi.stubEnv(key, value);
    const response = await POST(
      new Request("http://localhost/api/marketplaces/stockx/publish", { method: "POST" }),
    );
    expect(response.status).toBe(501);
    expect((await response.json()).error.code).toBe("STOCKX_LISTING_READINESS_REQUIRED");
  });
});
