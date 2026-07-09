import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));
vi.mock("@/lib/billing/account", () => ({
  getActiveAccount: vi.fn().mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" }),
}));

vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));

import { PATCH } from "./route";

describe("listing draft marketplace aspect persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
  });

  it("persists seller-filled eBay aspects while keeping existing eBay draft fields", async () => {
    const update = vi.fn().mockResolvedValue({
      id: "draft-1",
      marketplaceDrafts: {
        ebay: {
          categoryId: "15709",
          quantity: 1,
          aspects: { "US Shoe Size": "10.5", Color: "Aqua" },
        },
      },
    });
    const inventoryUpdate = vi.fn().mockResolvedValue({ id: "item-1" });
    const transaction = vi.fn(async (ops: unknown[]) => Promise.all(ops));

    mocks.getPrisma.mockReturnValue({
      listingDraft: {
        findFirst: vi.fn().mockResolvedValue({
          id: "draft-1",
          inventoryItemId: "item-1",
          marketplaceDrafts: {
            ebay: { categoryId: "15709", quantity: 1 },
          },
          inventoryItem: { productName: "Nike Air Max 1" },
        }),
        update,
      },
      inventoryItem: { update: inventoryUpdate },
      $transaction: transaction,
    });

    const response = await PATCH(
      new Request("http://localhost/api/listings/draft/draft-1", {
        method: "PATCH",
        body: JSON.stringify({
          title: "Nike Air Max 1 Patta Waves Noise Aqua",
          description: "Authentic pair.",
          bulletPoints: [],
          recommendedPriceCents: 24000,
          selectedMarketplaces: ["ebay"],
          marketplaceDrafts: {
            ebay: {
              categoryId: "15709",
              aspects: { "US Shoe Size": "10.5", Color: "Aqua" },
            },
          },
        }),
      }),
      { params: Promise.resolve({ draftId: "draft-1" }) },
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          marketplaceDrafts: {
            ebay: {
              categoryId: "15709",
              quantity: 1,
              aspects: { "US Shoe Size": "10.5", Color: "Aqua" },
            },
          },
        }),
      }),
    );
  });
});
