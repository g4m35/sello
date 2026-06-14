import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));

import { POST } from "./route";

function preflightRequest() {
  return new Request("http://localhost/api/listings/item-1/ebay-preflight", {
    method: "POST",
  });
}

const params = { params: Promise.resolve({ id: "item-1" }) };

describe("eBay preflight route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    process.env.EBAY_ENV = "production";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
  });

  it("returns the dry-run preview without any outbound eBay call", async () => {
    mocks.getPrisma.mockReturnValue({
      inventoryItem: {
        findFirst: vi.fn().mockResolvedValue({
          id: "item-1",
          sellerId: "user-1",
          brand: "Nike",
          condition: "new_with_tags",
          size: "US 10",
          colorway: "Aqua",
          listingDrafts: [
            {
              title: "Nike Air Max 1",
              description: "Great pair.",
              recommendedPriceCents: 12000,
              itemSpecifics: {},
              marketplaceDrafts: { ebay: { categoryId: "15709", quantity: 1 } },
            },
          ],
          photos: [{ storageBucket: "b", storagePath: "p1.jpg" }],
        }),
      },
      marketplaceConnection: {
        findUnique: vi.fn().mockResolvedValue({ id: "conn-1" }),
      },
      ebaySellerConfig: {
        findFirst: vi.fn().mockResolvedValue({
          marketplaceId: "EBAY_US",
          paymentPolicyId: "pay-1",
          fulfillmentPolicyId: "ful-1",
          returnPolicyId: "ret-1",
          merchantLocationKey: "sello-default-location",
        }),
      },
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const response = await POST(preflightRequest(), params);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.mode).toBe("dry_run");
    expect(payload.ready).toBe(true);
    expect(payload.publishingEnabled).toBe(false);
    expect(payload.preview.offer.categoryId).toBe("15709");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("404s for cross-seller items", async () => {
    mocks.getPrisma.mockReturnValue({
      inventoryItem: { findFirst: vi.fn().mockResolvedValue(null) },
      marketplaceConnection: { findUnique: vi.fn() },
      ebaySellerConfig: { findFirst: vi.fn() },
    });

    const response = await POST(preflightRequest(), params);

    expect(response.status).toBe(404);
  });

  it("propagates auth failures as non-eBay errors", async () => {
    const { AppError } = await import("@/lib/errors");
    mocks.requireSupabaseUser.mockRejectedValue(new AppError("Sign in first.", 401));
    mocks.getPrisma.mockReturnValue({});

    const response = await POST(preflightRequest(), params);

    expect(response.status).toBe(401);
  });
});
