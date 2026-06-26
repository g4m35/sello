import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  createSupabaseServiceClient: vi.fn(),
  getActiveAccount: vi.fn(),
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

vi.mock("@/lib/billing/account", () => ({
  getActiveAccount: mocks.getActiveAccount,
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

vi.mock("server-only", () => ({}));

import { AppError } from "@/lib/errors";
import { GET } from "./route";

describe("listing detail route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
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
    expect(prisma.inventoryItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "item-1", accountId: "acc-1" }) }),
    );
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

  it("returns safe seller copy without raw Prisma, query, stack, or token text", async () => {
    mocks.getPrisma.mockReturnValue({
      inventoryItem: {
        findFirst: vi.fn().mockRejectedValue(
          new Error(
            "PrismaClientKnownRequestError Invalid prisma.inventoryItem query token=tok_live_secret",
          ),
        ),
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await GET(
      new Request("http://localhost/api/listings/item-1"),
      { params: Promise.resolve({ id: "item-1" }) },
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toEqual({
      error: {
        code: "LISTING_LOAD_FAILED",
        message: "Couldn't load this listing right now. Please try again.",
      },
    });
    expect(body).not.toMatch(/Prisma|query|stack|tok_live_secret/i);
  });

  it("preserves a safe typed auth failure", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(
      new AppError("Sign in to view this listing.", 401, "AUTH_REQUIRED"),
    );

    const response = await GET(
      new Request("http://localhost/api/listings/item-1"),
      { params: Promise.resolve({ id: "item-1" }) },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "AUTH_REQUIRED",
        message: "Sign in to view this listing.",
      },
    });
  });
});
