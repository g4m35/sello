import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));

import { AppError } from "@/lib/errors";

import { DELETE, PATCH } from "./route";

const params = Promise.resolve({ compId: "11111111-1111-1111-1111-111111111111" });

describe("price comp [compId] API auth boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUser.mockRejectedValue(
      new AppError("Sign in before creating a listing draft.", 401),
    );
  });

  it("rejects updating a comp when the seller is not signed in", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/listings/comps/abc", {
        method: "PATCH",
        body: JSON.stringify({ usedInPricing: false }),
      }),
      { params },
    );
    const payload = await response.json();
    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });

  it("401s an unauthenticated update even when the body is invalid (auth before parse)", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/listings/comps/abc", {
        method: "PATCH",
        body: JSON.stringify({}),
      }),
      { params },
    );
    const payload = await response.json();
    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });

  it("rejects deleting a comp when the seller is not signed in", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/listings/comps/abc", { method: "DELETE" }),
      { params },
    );
    const payload = await response.json();
    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });

  it("hides automatic provider ids in the response after deleting a manual comp", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    const automaticComp = {
      id: "auto-1",
      inventoryItemId: "item-1",
      source: "auto:apify-ebay-sold",
      sourceType: "api",
      status: "sold",
      title: "Automatic comp",
      priceCents: 12000,
      shippingCents: 0,
      totalPriceCents: 12000,
      currency: "USD",
      soldDate: null,
      url: null,
      imageUrl: null,
      condition: "used_good",
      matchScore: 0.9,
      usedInPricing: true,
      ignoredAsOutlier: false,
      rawJson: null,
      notes: null,
      createdAt: new Date(),
    };
    const prisma = {
      priceComp: {
        findFirst: vi.fn().mockResolvedValue({ id: "manual-1", inventoryItemId: "item-1" }),
        delete: vi.fn().mockResolvedValue({ id: "manual-1" }),
        findMany: vi.fn().mockResolvedValue([automaticComp]),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await DELETE(
      new Request("http://localhost/api/listings/comps/manual-1", { method: "DELETE" }),
      { params },
    );
    const payload = await response.json();
    const serialized = JSON.stringify(payload);

    expect(response.status).toBe(200);
    expect(payload.comps[0].source).toBe("Fresh sold comps");
    expect(serialized).not.toContain("apify-ebay-sold");
  });

  it("sanitizes an unexpected database failure while deleting a comp", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    const prisma = {
      priceComp: {
        findFirst: vi.fn().mockResolvedValue({ id: "manual-1", inventoryItemId: "item-1" }),
        delete: vi.fn().mockRejectedValue(
          new Error("PrismaClientKnownRequestError query token=tok_live_secret"),
        ),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await DELETE(
      new Request("http://localhost/api/listings/comps/manual-1", { method: "DELETE" }),
      { params },
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toEqual({
      error: {
        code: "COMP_DELETE_FAILED",
        message: "Couldn't delete this comp right now. Please try again.",
      },
    });
    expect(body).not.toMatch(/Prisma|query|tok_live_secret/i);
  });
});
