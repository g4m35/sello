import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
  runCompFetch: vi.fn(),
  enabledCompSources: vi.fn(),
  mapAttempt: vi.fn((attempt) => attempt),
  mapItemDetail: vi.fn(() => ({ id: "item-1" })),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
  createSupabaseServiceClient: mocks.createSupabaseServiceClient,
}));

vi.mock("@/lib/comps/fetch", () => ({
  runCompFetch: mocks.runCompFetch,
}));

vi.mock("@/lib/comps/registry", () => ({
  enabledCompSources: mocks.enabledCompSources,
}));

vi.mock("@/lib/view/server-map", () => ({
  mapAttempt: mocks.mapAttempt,
  mapItemDetail: mocks.mapItemDetail,
}));

import { GET } from "./route";

describe("listing detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    mocks.enabledCompSources.mockReturnValue(["ebay_browse"]);
    mocks.createSupabaseServiceClient.mockReturnValue({
      storage: {
        from: vi.fn().mockReturnValue({
          createSignedUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "signed" } }),
        }),
      },
    });
  });

  it("does not auto-fetch external comps when opening the listing page", async () => {
    const prisma = {
      inventoryItem: {
        findFirst: vi.fn().mockResolvedValue({
          id: "item-1",
          sellerId: "user-1",
          listingDrafts: [],
          marketplaceListings: [],
          photos: [],
        }),
      },
      priceComp: {
        count: vi.fn().mockResolvedValue(0),
      },
      publishAttempt: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await GET(
      new Request("http://localhost/api/listings/item-1"),
      { params: Promise.resolve({ id: "item-1" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.runCompFetch).not.toHaveBeenCalled();
    expect(prisma.priceComp.count).not.toHaveBeenCalled();
  });

  it("keeps editor photo display on private signed URLs", async () => {
    const createSignedUrl = vi
      .fn()
      .mockResolvedValue({ data: { signedUrl: "https://signed.example/photo" } });
    mocks.createSupabaseServiceClient.mockReturnValue({
      storage: {
        from: vi.fn().mockReturnValue({ createSignedUrl }),
      },
    });
    const prisma = {
      inventoryItem: {
        findFirst: vi.fn().mockResolvedValue({
          id: "item-1",
          sellerId: "user-1",
          listingDrafts: [],
          marketplaceListings: [],
          photos: [
            {
              id: "photo-1",
              storageBucket: "listing-photos",
              storagePath: "user-1/item-1/private.jpg",
              position: 0,
            },
          ],
        }),
      },
      publishAttempt: {
        findMany: vi.fn().mockResolvedValue([]),
      },
    };
    mocks.getPrisma.mockReturnValue(prisma);

    const response = await GET(
      new Request("http://localhost/api/listings/item-1"),
      { params: Promise.resolve({ id: "item-1" }) },
    );

    expect(response.status).toBe(200);
    expect(createSignedUrl).toHaveBeenCalledWith("user-1/item-1/private.jpg", 60 * 60);
    expect(mocks.mapItemDetail).toHaveBeenCalledWith(
      expect.anything(),
      [],
      expect.any(Map),
    );
    const lastMapCall = mocks.mapItemDetail.mock.calls.at(-1) as
      | unknown[]
      | undefined;
    const photoUrls = lastMapCall?.[2] as Map<string, string>;
    expect(photoUrls.get("photo-1")).toBe("https://signed.example/photo");
  });
});
