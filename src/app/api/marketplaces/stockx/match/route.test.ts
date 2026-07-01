import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabaseUser: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  loadItemDetailState: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));
vi.mock("@/lib/billing/account", () => ({
  getActiveAccount: vi.fn().mockResolvedValue({ id: "acc-1", ownerUserId: "user-1" }),
}));
vi.mock("@/lib/billing/scope", () => ({
  inventoryChildScope: () => ({ inventoryItem: { accountId: "acc-1" } }),
}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({
    listingDraft: {
      findFirst: mocks.findFirst,
      update: mocks.update,
    },
  }),
}));
vi.mock("@/lib/view/load-item-detail", () => ({
  loadItemDetailState: mocks.loadItemDetailState,
}));

import { POST } from "./route";

const matchBody = {
  draftId: "00000000-0000-4000-8000-000000000001",
  productId: "p1",
  variantId: "v1",
  title: "Nike Dunk Low Panda",
  brand: "Nike",
  style: "DD1391-100",
  colorway: "White Black",
  size: "10",
  image: "https://images.stockx.com/panda.jpg",
  category: "sneakers",
  url: "https://stockx.com/nike-dunk-low-panda",
};

describe("StockX match route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    mocks.findFirst.mockResolvedValue({
      id: "draft-1",
      inventoryItemId: "item-1",
      marketplaceDrafts: { ebay: { categoryId: "123" } },
    });
    mocks.update.mockResolvedValue({});
    mocks.loadItemDetailState.mockResolvedValue({ id: "item-1", stockxMatch: {} });
  });

  it("saves the selected product and variant without dropping existing drafts", async () => {
    const response = await POST(
      new Request("http://localhost/api/marketplaces/stockx/match", {
        method: "POST",
        body: JSON.stringify(matchBody),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: {
        id: matchBody.draftId,
        inventoryItem: { accountId: "acc-1" },
      },
      select: {
        id: true,
        inventoryItemId: true,
        marketplaceDrafts: true,
      },
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "draft-1" },
      data: expect.objectContaining({
        stockxProductId: "p1",
        stockxVariantId: "v1",
        stockxMatchSource: "catalog_search",
        marketplaceDrafts: expect.objectContaining({
          ebay: { categoryId: "123" },
          stockx: expect.objectContaining({
            productId: "p1",
            variantId: "v1",
            title: "Nike Dunk Low Panda",
          }),
        }),
      }),
    });
  });

  it("rejects attempts outside the active account scope", async () => {
    mocks.findFirst.mockResolvedValue(null);
    const response = await POST(
      new Request("http://localhost/api/marketplaces/stockx/match", {
        method: "POST",
        body: JSON.stringify(matchBody),
      }),
    );
    expect(response.status).toBe(404);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
