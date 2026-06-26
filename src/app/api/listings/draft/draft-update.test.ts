import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));

vi.mock("@/lib/billing/account", () => ({
  getActiveAccount: mocks.getActiveAccount,
}));

vi.mock("server-only", () => ({}));

import { PATCH, POST } from "./[draftId]/route";

function completeStoredDraft() {
  return {
    id: "draft-1",
    inventoryItemId: "item-1",
    title: "Nike Air Max 1 Patta Waves Noise Aqua",
    description: "Authentic pair in great condition with original details. Ships fast.",
    bulletPoints: ["Nike Air Max", "Noise Aqua colorway", "US 10"],
    selectedMarketplaces: ["ebay"],
    recommendedPriceCents: 24000,
    itemSpecifics: {},
    marketplaceDrafts: {},
    inventoryItem: {
      productName: "Nike Air Max",
      condition: "used_good",
      category: "sneakers",
      brand: "Nike",
      size: "10",
      colorway: "Aqua",
      aiOutputs: [],
      _count: { photos: 3 },
    },
  };
}

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
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" });
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

  it("returns the refreshed item view (readiness/status) after a save", async () => {
    const update = vi.fn().mockResolvedValue({ id: "draft-1" });
    const refreshedItem = {
      id: "item-1",
      sellerId: "user-1",
      productName: "Nike Air Max",
      brand: "Nike",
      category: "sneakers",
      condition: "used_good",
      size: "US 10",
      colorway: "Aqua",
      styleCode: null,
      recommendedPriceCents: 24000,
      pricingRationale: null,
      status: "DRAFT_READY",
      updatedAt: new Date("2026-06-17T00:00:00.000Z"),
      listingDrafts: [
        {
          id: "draft-1",
          title: "Nike Air Max 1 Patta Waves Noise Aqua",
          description:
            "Authentic pair in great condition with original details. Ships fast.",
          bulletPoints: ["Nike Air Max", "Noise Aqua colorway", "US 10"],
          recommendedPriceCents: 24000,
          pricingRationale: null,
          selectedMarketplaces: ["ebay"],
          marketplaceDrafts: { ebay: { categoryId: "15709" } },
          measurements: null,
          flaws: null,
          itemSpecifics: {},
          updatedAt: new Date("2026-06-17T00:00:00.000Z"),
        },
      ],
      marketplaceListings: [],
      photos: [],
    };
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
        findFirst: vi.fn().mockResolvedValue(refreshedItem),
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
    const payload = await response.json();
    expect(payload.item).not.toBeNull();
    expect(payload.item.id).toBe("item-1");
    expect(payload.item.readiness).toBeDefined();
    expect(typeof payload.item.readiness.ready).toBe("boolean");
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

  it("approve action marks a complete stored draft ready without resending fields", async () => {
    const draftUpdate = vi.fn().mockResolvedValue({ id: "draft-1", status: "APPROVED" });
    const itemUpdate = vi.fn().mockResolvedValue({ id: "item-1", status: "APPROVED" });
    mocks.getPrisma.mockReturnValue({
      listingDraft: {
        findFirst: vi.fn().mockResolvedValue(completeStoredDraft()),
        update: draftUpdate,
      },
      inventoryItem: { update: itemUpdate },
      $transaction: vi.fn(async (ops) => Promise.all(ops)),
    });

    const response = await POST(
      new Request("http://localhost/api/listings/draft/draft-1", {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: JSON.stringify({ action: "approve" }),
      }),
      { params: Promise.resolve({ draftId: "draft-1" }) },
    );

    expect(response.status).toBe(200);
    expect(draftUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "APPROVED" }) }),
    );
    expect(itemUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "APPROVED" } }),
    );
  });

  it("approve action refuses a size-required draft that has no size", async () => {
    const stored = completeStoredDraft();
    const missingSize = {
      ...stored,
      inventoryItem: { ...stored.inventoryItem, size: null },
    };
    const update = vi.fn();
    mocks.getPrisma.mockReturnValue({
      listingDraft: { findFirst: vi.fn().mockResolvedValue(missingSize), update },
      inventoryItem: { update },
      $transaction: vi.fn(),
    });

    const response = await POST(
      new Request("http://localhost/api/listings/draft/draft-1", {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: JSON.stringify({ action: "approve" }),
      }),
      { params: Promise.resolve({ draftId: "draft-1" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/size/i);
    expect(update).not.toHaveBeenCalled();
  });

  it("approve action refuses an incomplete draft with a plain-language reason", async () => {
    const incomplete = { ...completeStoredDraft(), recommendedPriceCents: null };
    const update = vi.fn();
    mocks.getPrisma.mockReturnValue({
      listingDraft: { findFirst: vi.fn().mockResolvedValue(incomplete), update },
      inventoryItem: { update },
      $transaction: vi.fn(),
    });

    const response = await POST(
      new Request("http://localhost/api/listings/draft/draft-1", {
        method: "POST",
        headers: { authorization: "Bearer token" },
        body: JSON.stringify({ action: "approve" }),
      }),
      { params: Promise.resolve({ draftId: "draft-1" }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toMatch(/not ready/i);
    expect(payload.error).toMatch(/price/i);
    expect(update).not.toHaveBeenCalled();
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
