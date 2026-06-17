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
const key =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const derivativeUrl =
  "https://project.supabase.co/storage/v1/object/public/ebay-public/ebay/production/item-1/photo-1/derivative.jpg";

function readyPrisma(overrides: Record<string, unknown> = {}) {
  return {
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
        photos: [
          {
            id: "photo-1",
            inventoryItemId: "item-1",
            storageBucket: "listing-photos",
            storagePath: "user-1/item-1/private-front.jpg",
            mimeType: "image/jpeg",
            originalName: "front.jpg",
            position: 0,
          },
        ],
        ...overrides,
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
    marketplaceImage: {
      findMany: vi.fn().mockResolvedValue([
        {
          itemPhotoId: "photo-1",
          marketplace: "ebay",
          environment: "production",
          storagePath: "ebay/production/item-1/photo-1/derivative.jpg",
          publicUrl: derivativeUrl,
          status: "READY",
        },
      ]),
      upsert: vi.fn(async ({ create }) => create),
    },
  };
}

describe("eBay preflight route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    process.env.EBAY_ENV = "production";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.EBAY_PUBLIC_IMAGE_BUCKET = "ebay-public";
    delete process.env.EBAY_CLIENT_ID;
    delete process.env.EBAY_CLIENT_SECRET;
    delete process.env.EBAY_REDIRECT_URI_NAME;
    delete process.env.EBAY_TOKEN_ENCRYPTION_KEY;
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
  });

  it("returns the dry-run preview without any outbound eBay call", async () => {
    mocks.getPrisma.mockReturnValue(readyPrisma());
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

  it("uses eBay Taxonomy requirements when app credentials are configured", async () => {
    process.env.EBAY_CLIENT_ID = "client-id";
    process.env.EBAY_CLIENT_SECRET = "client-secret";
    process.env.EBAY_REDIRECT_URI_NAME = "redirect-name";
    process.env.EBAY_TOKEN_ENCRYPTION_KEY = key;
    mocks.getPrisma.mockReturnValue(
      readyPrisma({
        brand: "The North Face",
        condition: "used_good",
        size: "S",
        colorway: "Black",
        listingDrafts: [
          {
            title: "The North Face Black Nuptse Puffer Jacket",
            description: "Classic black Nuptse jacket.",
            recommendedPriceCents: 16500,
            itemSpecifics: {},
            marketplaceDrafts: { ebay: { categoryId: "57988", quantity: 1 } },
          },
        ],
      }),
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "app-token", expires_in: 7200 }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            aspects: [
              {
                localizedAspectName: "Brand",
                aspectConstraint: { aspectRequired: true, aspectUsage: "RECOMMENDED" },
              },
              {
                localizedAspectName: "Type",
                aspectConstraint: {
                  aspectRequired: true,
                  aspectUsage: "RECOMMENDED",
                  aspectMode: "SELECTION_ONLY",
                },
                aspectValues: [{ localizedValue: "Puffer Jacket" }],
              },
            ],
          }),
          { status: 200 },
        ),
      );

    const response = await POST(preflightRequest(), params);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(payload.mode).toBe("dry_run");
    expect(payload.ready).toBe(false);
    expect(payload.aspects.source).toBe("taxonomy");
    expect(payload.missing).toContain("ebay_aspects");
    expect(payload.aspects.missingRequired).toEqual([
      expect.objectContaining({
        name: "Type",
        values: ["Puffer Jacket"],
      }),
    ]);
    expect(payload.preview).toBeNull();
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
