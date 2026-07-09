import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));
vi.mock("@/lib/billing/account", () => ({
  getActiveAccount: mocks.getActiveAccount,
}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: vi.fn(() => ({ prisma: true })),
}));

import { AppError } from "@/lib/errors";

import { GET } from "./route";

const request = () => new Request("http://localhost/api/capabilities");

describe("GET /api/capabilities", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.getActiveAccount.mockResolvedValue({
      id: "acc-1",
      ownerUserId: "user-1",
      plan: "pro",
    });
  });

  it("requires authentication", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(new AppError("Sign in", 401));

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Sign in" });
  });

  it("returns only independent booleans and safe public copy", async () => {
    vi.stubEnv("LIVE_EBAY_PUBLISH_EMAILS", "owner@example.com");
    vi.stubEnv("EBAY_DELIST_EMAILS", "beta@example.com");
    vi.stubEnv("PAID_COMPS_EMAILS", "OWNER@example.com");
    mocks.requireSupabaseUser.mockResolvedValue({
      id: "user-1",
      email: "owner@example.com",
    });

    const response = await GET(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      access: {
        liveEbayPublish: true,
        ebayDelist: false,
        paidComps: true,
        etsyConnect: false,
        etsyPublish: false,
        etsyDelist: false,
        etsyOrders: false,
      },
      copy: {
        liveEbayPublish:
          "Live eBay publishing is currently enabled for selected alpha accounts.",
        ebayDelist:
          "Live eBay delisting is currently enabled for selected alpha accounts.",
        paidComps:
          "Fresh sold comps are currently enabled for selected alpha accounts.",
        etsyConnect:
          "Connecting an Etsy shop is currently enabled for selected alpha accounts.",
        etsyPublish:
          "Live Etsy publishing is currently enabled for selected alpha accounts.",
        etsyDelist:
          "Live Etsy delisting is currently enabled for selected alpha accounts.",
        etsyOrders:
          "Etsy order sync is currently enabled for selected alpha accounts.",
      },
      plan: "pro",
      limits: {
        aiListingsPerMonth: 125,
        autopublishesPerMonth: 125,
        compRefreshesPerMonth: 100,
        marketplaceConnections: 3,
        bulkBatchSize: 25,
        teamSeats: 1,
      },
    });

    const serialized = JSON.stringify(payload).toLowerCase();
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("beta@example.com");
    expect(serialized).not.toContain("emails");
    expect(Object.keys(payload)).toEqual(["access", "copy", "plan", "limits"]);
  });

  it("returns kingpin limits for an admin even when the stored account is free", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    mocks.requireSupabaseUser.mockResolvedValue({
      id: "user-1",
      email: "owner@example.com",
    });
    mocks.getActiveAccount.mockResolvedValue({
      id: "acc-1",
      ownerUserId: "user-1",
      plan: "free",
    });

    const payload = await (await GET(request())).json();

    expect(payload.plan).toBe("kingpin");
    expect(payload.limits.compRefreshesPerMonth).toBe(750);
    expect(payload.limits.bulkBatchSize).toBe(250);
  });
});
