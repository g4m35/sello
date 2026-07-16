import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
  resolveRuntimeEntitlements: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/auth/feature-access", () => ({
  resolveRuntimeEntitlements: mocks.resolveRuntimeEntitlements,
}));

import { GET, POST } from "./route";

describe("price comps API auth boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const account = { id: "acc-1", ownerUserId: "user-1", plan: "free" };
    mocks.getActiveAccount.mockResolvedValue(account);
    mocks.resolveRuntimeEntitlements.mockImplementation(async (user: { email?: string | null }) => ({
      account,
      access: {
        paidComps: user.email === "allowed@example.com" || user.email === "owner@example.com",
      },
      decisions: {},
      plan: account.plan,
      limits: {},
      features: {},
    }));
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
    expect(prisma.inventoryItem.findFirst).toHaveBeenCalledWith({
      where: { id: inventoryItemId, accountId: "acc-1" },
      select: { id: true },
    });
    expect(prisma.priceComp.create).toHaveBeenCalledTimes(1);
    expect(prisma.compSearchRun.findFirst).not.toHaveBeenCalled();
    expect(prisma.providerCallLedger.create).not.toHaveBeenCalled();
  });

  it("keeps manual source names but hides automatic provider ids after adding a comp", async () => {
    const inventoryItemId = "11111111-1111-4111-8111-111111111111";
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "seller@example.com" });
    const manualComp = {
      id: "manual-1",
      inventoryItemId,
      source: "Seller research",
      sourceType: "manual",
      status: "sold",
      title: "Seller-entered comp",
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
    const automaticComp = {
      ...manualComp,
      id: "auto-1",
      source: "auto:apify-ebay-sold",
      sourceType: "api",
      title: "Automatic comp",
    };
    const prisma = {
      inventoryItem: { findFirst: vi.fn().mockResolvedValue({ id: inventoryItemId }) },
      priceComp: {
        create: vi.fn().mockResolvedValue(manualComp),
        findMany: vi.fn().mockResolvedValue([manualComp, automaticComp]),
      },
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
            title: "Seller-entered comp",
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
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(prisma.inventoryItem.findFirst).toHaveBeenCalledWith({
      where: { id: inventoryItemId, accountId: "acc-1" },
      select: { id: true },
    });
    expect(payload.comps.map((comp: { source: string }) => comp.source)).toEqual([
      "Seller research",
      "Fresh sold comps",
    ]);
    expect(serialized).not.toContain("apify-ebay-sold");
  });

  it("sanitizes an unexpected DB error when adding a manual comp", async () => {
    const inventoryItemId = "11111111-1111-4111-8111-111111111111";
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "seller@example.com" });
    const raw = new Error("Failed to deserialize column of type 'void'. token=tok_live_secret");
    raw.name = "PrismaClientKnownRequestError";
    const prisma = {
      inventoryItem: { findFirst: vi.fn().mockResolvedValue({ id: inventoryItemId }) },
      priceComp: { create: vi.fn().mockRejectedValue(raw) },
    };
    mocks.getPrisma.mockReturnValue(prisma);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

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
    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).not.toContain("void");
    expect(body).not.toContain("Prisma");
    expect(body).not.toContain("deserialize");
    expect(body).not.toContain("tok_live_secret");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("tok_live_secret");
    consoleError.mockRestore();
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
    expect(prisma.inventoryItem.findFirst).toHaveBeenCalledWith({
      where: { id: "item-1", accountId: "acc-1" },
      select: { id: true },
    });
    expect(payload.discovery.paidProvidersEnabled).toBe(false);
    expect(serialized).not.toMatch(/apify-ebay-sold|global_budget_exceeded/);
  });

  it("does not surface a cooldown countdown when fresh comps are disabled", async () => {
    // Env kill switch off, but a recent run exists. The seller should see the
    // disabled state, not a (stale, un-actionable) refresh countdown.
    vi.stubEnv("COMPS_PAID_PROVIDERS_ENABLED", "");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "u@example.com" });
    const prisma = {
      inventoryItem: { findFirst: vi.fn().mockResolvedValue({ id: "item-1" }) },
      priceComp: { findMany: vi.fn().mockResolvedValue([]) },
      compSearchRun: {
        findFirst: vi.fn().mockResolvedValue({
          status: "found_comps",
          queries: [],
          sourceErrors: [],
          createdAt: new Date(), // just now -> would otherwise show a full cooldown
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

    expect(response.status).toBe(200);
    expect(payload.discovery.paidProvidersEnabled).toBe(false);
    expect(payload.discovery.cooldownSecondsRemaining).toBe(0);
  });
});
