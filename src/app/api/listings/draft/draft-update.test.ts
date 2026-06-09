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

import { PATCH } from "./[draftId]/route";

function validPatchBody() {
  return {
    title: "Nike Air Max 1 Patta Waves Noise Aqua",
    description:
      "Authentic pair in great condition with original details. Ships fast from a smoke-free home.",
    bulletPoints: ["Nike Air Max", "Noise Aqua colorway", "US 10"],
    recommendedPriceCents: 24000,
    marketplaceDrafts: {
      ebay: { categoryId: "15709" },
    },
    selectedMarketplaces: ["ebay"],
  };
}

describe("listing draft update marketplace fields", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
  });

  it("saves the eBay category ID into marketplaceDrafts for the signed-in seller", async () => {
    const existingMarketplaceDrafts = {
      ebay: {
        title: "old ebay title",
        description: "old ebay description",
        categoryHint: "Athletic Shoes",
        tags: ["nike"],
      },
      grailed: {
        title: "grailed title",
        description: "grailed description",
        categoryHint: "Footwear",
        tags: ["nike"],
      },
    };
    const update = vi.fn().mockResolvedValue({
      id: "draft-1",
      marketplaceDrafts: {
        ...existingMarketplaceDrafts,
        ebay: { ...existingMarketplaceDrafts.ebay, categoryId: "15709" },
      },
    });

    mocks.getPrisma.mockReturnValue({
      listingDraft: {
        findFirst: vi.fn().mockResolvedValue({
          id: "draft-1",
          inventoryItemId: "item-1",
          marketplaceDrafts: existingMarketplaceDrafts,
          inventoryItem: { productName: "Nike Air Max" },
        }),
        update,
      },
      inventoryItem: {
        update: vi.fn().mockResolvedValue({ id: "item-1" }),
      },
      $transaction: vi.fn(async (ops) => Promise.all(ops)),
    });

    const response = await PATCH(
      new Request("http://localhost/api/listings/draft/draft-1", {
        method: "PATCH",
        headers: { authorization: "Bearer token" },
        body: JSON.stringify(validPatchBody()),
      }),
      { params: Promise.resolve({ draftId: "draft-1" }) },
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "draft-1" },
        data: expect.objectContaining({
          marketplaceDrafts: expect.objectContaining({
            ebay: expect.objectContaining({ categoryId: "15709" }),
            grailed: existingMarketplaceDrafts.grailed,
          }),
        }),
      }),
    );
  });

  it("persists structured measurements and flaws when provided", async () => {
    const update = vi.fn().mockResolvedValue({ id: "draft-1" });
    mocks.getPrisma.mockReturnValue({
      listingDraft: {
        findFirst: vi.fn().mockResolvedValue({
          id: "draft-1",
          inventoryItemId: "item-1",
          marketplaceDrafts: {},
          inventoryItem: { productName: "Nike Air Max" },
        }),
        update,
      },
      inventoryItem: {
        update: vi.fn().mockResolvedValue({ id: "item-1" }),
      },
      $transaction: vi.fn(async (ops) => Promise.all(ops)),
    });

    const measurements = [
      { label: "Insole length", value: "28", unit: "cm", source: "seller" },
      { label: "Pit to pit", value: null, unit: "unknown" },
    ];
    const flaws = [
      {
        label: "Heel drag",
        description: "Light tread wear on both heels",
        severity: "minor",
        source: "seller",
      },
    ];

    const response = await PATCH(
      new Request("http://localhost/api/listings/draft/draft-1", {
        method: "PATCH",
        headers: { authorization: "Bearer token" },
        body: JSON.stringify({ ...validPatchBody(), measurements, flaws }),
      }),
      { params: Promise.resolve({ draftId: "draft-1" }) },
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ measurements, flaws }),
      }),
    );
  });

  it("leaves stored measurements and flaws untouched when the payload omits them", async () => {
    const update = vi.fn().mockResolvedValue({ id: "draft-1" });
    mocks.getPrisma.mockReturnValue({
      listingDraft: {
        findFirst: vi.fn().mockResolvedValue({
          id: "draft-1",
          inventoryItemId: "item-1",
          marketplaceDrafts: {},
          inventoryItem: { productName: "Nike Air Max" },
        }),
        update,
      },
      inventoryItem: {
        update: vi.fn().mockResolvedValue({ id: "item-1" }),
      },
      $transaction: vi.fn(async (ops) => Promise.all(ops)),
    });

    const response = await PATCH(
      new Request("http://localhost/api/listings/draft/draft-1", {
        method: "PATCH",
        headers: { authorization: "Bearer token" },
        body: JSON.stringify(validPatchBody()),
      }),
      { params: Promise.resolve({ draftId: "draft-1" }) },
    );

    expect(response.status).toBe(200);
    const data = update.mock.calls[0][0].data;
    expect("measurements" in data).toBe(false);
    expect("flaws" in data).toBe(false);
  });

  it("rejects malformed measurements", async () => {
    mocks.getPrisma.mockReturnValue({
      listingDraft: { findFirst: vi.fn(), update: vi.fn() },
      inventoryItem: { update: vi.fn() },
      $transaction: vi.fn(),
    });

    const response = await PATCH(
      new Request("http://localhost/api/listings/draft/draft-1", {
        method: "PATCH",
        headers: { authorization: "Bearer token" },
        body: JSON.stringify({
          ...validPatchBody(),
          measurements: [{ label: "Chest", value: "21", unit: "feet" }],
        }),
      }),
      { params: Promise.resolve({ draftId: "draft-1" }) },
    );

    expect(response.status).toBe(400);
  });

  it("does not update another seller's draft", async () => {
    const update = vi.fn();
    mocks.getPrisma.mockReturnValue({
      listingDraft: {
        findFirst: vi.fn().mockResolvedValue(null),
        update,
      },
      inventoryItem: {
        update: vi.fn(),
      },
      $transaction: vi.fn(),
    });

    const response = await PATCH(
      new Request("http://localhost/api/listings/draft/draft-1", {
        method: "PATCH",
        headers: { authorization: "Bearer token" },
        body: JSON.stringify(validPatchBody()),
      }),
      { params: Promise.resolve({ draftId: "draft-1" }) },
    );

    expect(response.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });
});
