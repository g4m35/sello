import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));

import { GET, POST } from "./route";

describe("price comps API auth boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUser.mockRejectedValue(
      new AppError("Sign in before creating a listing draft.", 401),
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects loading comps when the seller is not signed in", async () => {
    const response = await GET(
      new Request("http://localhost/api/listings/comps", { method: "GET" }),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });

  it("rejects adding a comp when the seller is not signed in", async () => {
    const response = await POST(
      new Request("http://localhost/api/listings/comps", {
        method: "POST",
        body: JSON.stringify({ inventoryItemId: "x", comp: {} }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });

  it("keeps manual comps available without paid entitlement or provider capacity", async () => {
    const inventoryItemId = "11111111-1111-4111-8111-111111111111";
    vi.stubEnv("PAID_COMPS_EMAILS", "allowed@example.com");
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "false");
    mocks.requireSupabaseUser.mockResolvedValue({
      id: "user-1",
      email: "not-allowed@example.com",
    });
    const manualComp = {
      id: "comp-1",
      inventoryItemId,
      source: "Seller research",
      sourceType: "manual",
      status: "sold",
      title: "Nike Dunk Low Panda",
      priceCents: 12000,
      shippingCents: 0,
      totalPriceCents: 12000,
      currency: "USD",
      soldDate: null,
      url: null,
      imageUrl: null,
      condition: "used_good",
      matchScore: null,
      usedInPricing: true,
      ignoredAsOutlier: false,
      rawJson: null,
      notes: null,
      createdAt: new Date(),
    };
    const prisma = {
      inventoryItem: { findFirst: vi.fn().mockResolvedValue({ id: inventoryItemId }) },
      priceComp: {
        create: vi.fn().mockResolvedValue(manualComp),
        findMany: vi.fn().mockResolvedValue([manualComp]),
      },
      compSearchRun: { findFirst: vi.fn() },
      providerCallLedger: { create: vi.fn() },
    };
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await POST(
      new Request("http://localhost/api/listings/comps", {
        method: "POST",
        body: JSON.stringify({
          inventoryItemId,
          comp: {
            source: "Seller research",
            sourceType: "manual",
            status: "sold",
            title: "Nike Dunk Low Panda",
            priceCents: 12000,
            shippingCents: 0,
            currency: "USD",
            condition: "used_good",
            usedInPricing: true,
            ignoredAsOutlier: false,
          },
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(prisma.priceComp.create).toHaveBeenCalledTimes(1);
    expect(prisma.compSearchRun.findFirst).not.toHaveBeenCalled();
    expect(prisma.providerCallLedger.create).not.toHaveBeenCalled();
  });

  it("combines the paid-provider kill switch with entitlement and hides provider details", async () => {
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "true");
    vi.stubEnv("PAID_COMPS_EMAILS", "allowed@example.com");
    mocks.requireSupabaseUser.mockResolvedValue({
      id: "user-1",
      email: "not-allowed@example.com",
    });
    const prisma = {
      inventoryItem: { findFirst: vi.fn().mockResolvedValue({ id: "item-1" }) },
      priceComp: { findMany: vi.fn().mockResolvedValue([]) },
      compSearchRun: {
        findFirst: vi.fn().mockResolvedValue({
          status: "found_comps",
          queries: ["nike dunk low panda"],
          sourceErrors: [
            {
              source: "apify-ebay-sold",
              message: "Paid comp providers skipped: global_budget_exceeded",
            },
          ],
          createdAt: new Date(0),
          acceptedCount: 0,
          rejectedCount: 0,
        }),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await GET(
      new Request("http://localhost/api/listings/comps?inventoryItemId=item-1"),
    );
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.discovery.paidProvidersEnabled).toBe(false);
    expect(serialized).not.toMatch(/apify-ebay-sold|global_budget_exceeded/);
  });
});
