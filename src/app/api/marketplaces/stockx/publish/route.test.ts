import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabaseUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));

import { POST } from "./route";

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
  });

  it("still requires future readiness gates even if the listing flag is enabled", async () => {
    vi.stubEnv("STOCKX_API_ENABLED", "true");
    vi.stubEnv("STOCKX_LISTING_ENABLED", "true");
    const response = await POST(
      new Request("http://localhost/api/marketplaces/stockx/publish", { method: "POST" }),
    );
    expect(response.status).toBe(501);
    expect((await response.json()).error.code).toBe("STOCKX_LISTING_READINESS_REQUIRED");
  });
});
