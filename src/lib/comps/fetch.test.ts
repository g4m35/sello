import { afterEach, describe, expect, it, vi } from "vitest";

import { runCompFetch } from "@/lib/comps/fetch";
import type { CompSource, NormalizedComp } from "@/lib/comps/source";

function comp(index: number, overrides: Partial<NormalizedComp> = {}): NormalizedComp {
  return {
    source: "test-source",
    externalId: `comp-${index}`,
    title: `The North Face Nuptse Black Puffer Jacket Large ${index}`,
    priceCents: 18000 + index * 500,
    shippingCents: 1000,
    soldDate: "2026-06-01T00:00:00.000Z",
    url: `https://example.com/${index}`,
    sold: true,
    condition: "used_good",
    brand: "The North Face",
    size: "Large",
    currency: "USD",
    imageUrl: null,
    rawJson: { id: index },
    ...overrides,
  };
}

describe("runCompFetch", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("records disabled and does not call providers when the master switch is off", async () => {
    vi.stubEnv("COMPS_AUTO_DISCOVERY_ENABLED", "false");
    vi.stubEnv("PRICE_COMP_AUTO_DISCOVERY_ENABLED", "false");

    const prisma = {
      inventoryItem: {
        findFirst: vi.fn(async () => ({
          id: "item-1",
          productName: "The North Face Black Nuptse Puffer Jacket",
          brand: "The North Face",
          styleCode: null,
          size: "Large",
          category: "streetwear",
          colorway: "Black",
          condition: "used_good",
          recommendedPriceCents: null,
          listingDrafts: [],
        })),
      },
      priceComp: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      compSearchRun: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "run-1",
          ...data,
        })),
      },
    };

    const result = await runCompFetch(prisma as never, "item-1", "seller-1");

    expect(result.status).toBe("disabled");
    expect(result.enabled).toBe(0);
    expect(result.sources).toEqual([]);
    expect(prisma.priceComp.deleteMany).not.toHaveBeenCalled();
    expect(prisma.priceComp.createMany).not.toHaveBeenCalled();
    expect(prisma.compSearchRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryItemId: "item-1",
        status: "disabled",
        autoDiscoveryEnabled: false,
        sourceCount: 0,
        fetchedCount: 0,
      }),
    });
  });

  it("allows an explicit refresh to run while automatic discovery remains off", async () => {
    vi.stubEnv("COMPS_AUTO_DISCOVERY_ENABLED", "false");
    vi.stubEnv("PRICE_COMP_AUTO_DISCOVERY_ENABLED", "false");
    const createdRows: unknown[] = [];
    const source: CompSource = {
      id: "test-source",
      displayName: "Test source",
      sold: true,
      resultKind: "sold_comps",
      isEnabled: () => true,
      fetchComps: vi.fn(async () => [comp(1), comp(2), comp(3)]),
    };

    const prisma = {
      inventoryItem: {
        findFirst: vi.fn(async () => ({
          id: "item-1",
          productName: "The North Face Black Nuptse Puffer Jacket",
          brand: "The North Face",
          styleCode: null,
          size: "Large",
          category: "streetwear",
          colorway: "Black",
          condition: "used_good",
          recommendedPriceCents: 18000,
          listingDrafts: [],
        })),
      },
      listingDraft: { update: vi.fn(async () => ({})) },
      priceComp: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
          createdRows.push(...data);
          return { count: data.length };
        }),
        findMany: vi.fn(async () => createdRows),
      },
      compSearchRun: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "run-1",
          ...data,
        })),
      },
    };

    const result = await runCompFetch(prisma as never, "item-1", "seller-1", {
      force: true,
      sources: [source],
    });

    expect(source.fetchComps).toHaveBeenCalledTimes(1);
    expect(result.fetched).toBe(3);
    expect(prisma.compSearchRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryItemId: "item-1",
        autoDiscoveryEnabled: false,
        sourceCount: 1,
        fetchedCount: 3,
      }),
    });
  });

  it("skips automatic paid providers for weak generic item identity", async () => {
    vi.stubEnv("COMPS_AUTO_DISCOVERY_ENABLED", "true");
    vi.stubEnv("COMPS_AUTO_MIN_IDENTITY_CONFIDENCE", "0.55");
    const source: CompSource = {
      id: "test-source",
      displayName: "Test source",
      sold: true,
      resultKind: "sold_comps",
      paid: true,
      isEnabled: () => true,
      fetchComps: vi.fn(async () => [comp(1)]),
    };

    const prisma = {
      inventoryItem: {
        findFirst: vi.fn(async () => ({
          id: "item-1",
          productName: "Basic Black Crew Neck Short Sleeve T-Shirt",
          brand: "Unknown",
          styleCode: null,
          size: null,
          category: "streetwear",
          colorway: "Black",
          condition: "unknown",
          confidence: 0.3,
          recommendedPriceCents: null,
          listingDrafts: [
            {
              title: "Basic Black Crew Neck Short Sleeve T-Shirt",
              description: "Plain black shirt.",
              recommendedPriceCents: null,
            },
          ],
        })),
      },
      priceComp: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      compSearchRun: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "run-1",
          ...data,
        })),
      },
      providerCallLedger: { create: vi.fn(async () => ({ id: "ledger-1" })) },
    };

    const result = await runCompFetch(prisma as never, "item-1", "seller-1", {
      paidProvidersAllowed: true,
      sources: [source],
    });

    expect(result.status).toBe("skipped_weak_identity");
    expect(source.fetchComps).not.toHaveBeenCalled();
    expect(prisma.priceComp.deleteMany).not.toHaveBeenCalled();
    expect(prisma.providerCallLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "skipped",
        skippedReason: "weak_identity",
        estimatedCostCents: 0,
      }),
    });
    expect(prisma.compSearchRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "skipped_weak_identity",
        sourceCount: 0,
        fetchedCount: 0,
        confidence: "none",
      }),
    });
  });

  it("never lets force bypass paid-provider identity gating and still runs free sources", async () => {
    vi.stubEnv("COMPS_AUTO_DISCOVERY_ENABLED", "true");
    vi.stubEnv("COMPS_AUTO_MIN_IDENTITY_CONFIDENCE", "0.9");
    const createdRows: unknown[] = [];
    const paidSource: CompSource = {
      id: "paid-sold-source",
      displayName: "Paid sold source",
      sold: true,
      resultKind: "sold_comps",
      paid: true,
      isEnabled: () => true,
      fetchComps: vi.fn(async () => [comp(1), comp(2), comp(3)]),
    };
    const freeSource: CompSource = {
      id: "free-active-source",
      displayName: "Free active source",
      sold: false,
      resultKind: "active_listings",
      isEnabled: () => true,
      fetchComps: vi.fn(async () => [
        comp(4, { source: "free-active-source", sold: false, soldDate: null }),
      ]),
    };

    const prisma = {
      inventoryItem: {
        findFirst: vi.fn(async () => ({
          id: "item-1",
          productName: "The North Face Black Nuptse Puffer Jacket",
          brand: "The North Face",
          styleCode: null,
          size: "Large",
          category: "streetwear",
          colorway: "Black",
          condition: "used_good",
          confidence: 0.1,
          recommendedPriceCents: 1200,
          listingDrafts: [],
        })),
      },
      listingDraft: { update: vi.fn(async () => ({})) },
      priceComp: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
          createdRows.push(...data);
          return { count: data.length };
        }),
        findMany: vi.fn(async () => createdRows),
      },
      compSearchRun: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: "run-1",
          ...data,
        })),
      },
      providerCallLedger: { create: vi.fn(async () => ({ id: "ledger-1" })) },
    };

    const result = await runCompFetch(prisma as never, "item-1", "seller-1", {
      force: true,
      paidProvidersAllowed: true,
      sources: [paidSource, freeSource],
    });

    expect(paidSource.fetchComps).not.toHaveBeenCalled();
    expect(freeSource.fetchComps).toHaveBeenCalledTimes(1);
    expect(result.status).not.toBe("skipped_weak_identity");
    expect(result.fetched).toBe(1);
    expect(result.sourceErrors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "sello",
          message: expect.stringMatching(/identity/i),
        }),
      ]),
    );
  });

  it("caps query variants before calling providers", async () => {
    vi.stubEnv("COMPS_AUTO_DISCOVERY_ENABLED", "true");
    vi.stubEnv("COMPS_MAX_QUERY_VARIANTS", "1");
    const source: CompSource = {
      id: "test-source",
      displayName: "Test source",
      sold: true,
      resultKind: "sold_comps",
      isEnabled: () => true,
      fetchComps: vi.fn(async () => []),
    };
    const prisma = {
      inventoryItem: {
        findFirst: vi.fn(async () => ({
          id: "item-1",
          productName: "The North Face Black Nuptse Puffer Jacket",
          brand: "The North Face",
          styleCode: null,
          size: "Large",
          category: "streetwear",
          colorway: "Black",
          condition: "used_good",
          confidence: 0.9,
          recommendedPriceCents: null,
          listingDrafts: [],
        })),
      },
      priceComp: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn(async () => []) },
      compSearchRun: { create: vi.fn(async () => ({ id: "run-1" })) },
    };

    const result = await runCompFetch(prisma as never, "item-1", "seller-1", {
      sources: [source],
    });

    expect(result.queries).toHaveLength(1);
    expect(source.fetchComps).toHaveBeenCalledWith(
      expect.objectContaining({
        variants: expect.arrayContaining([expect.objectContaining({ kind: "strict" })]),
      }),
    );
    expect(source.fetchComps).toHaveBeenCalledWith(
      expect.objectContaining({ variants: expect.not.arrayContaining([expect.objectContaining({ kind: "broad" })]) }),
    );
  });

  it("persists source run metadata, stores accepted/rejected comps, and auto-fills high-confidence pricing", async () => {
    const createdRows: unknown[] = [];
    const source: CompSource = {
      id: "test-source",
      displayName: "Test source",
      sold: true,
      resultKind: "sold_comps",
      isEnabled: () => true,
      fetchComps: vi.fn(async () => [
        comp(1),
        comp(2),
        comp(3),
        comp(4),
        comp(5),
        comp(6, {
          title: "Nike Dunk Low Panda Size 10",
          brand: "Nike",
          category: "sneakers",
          size: "10",
        }),
      ]),
    };

    const prisma = {
      inventoryItem: {
        findFirst: vi.fn(
          async ({ where }: { where: { id: string; sellerId: string } }) =>
            where.id === "item-1" && where.sellerId === "seller-1"
              ? {
                  id: "item-1",
                  productName: "The North Face Black Nuptse Puffer Jacket",
                  brand: "The North Face",
                  styleCode: null,
                  size: "Large",
                  category: "streetwear",
                  colorway: "Black",
                  condition: "used_good",
                  recommendedPriceCents: null,
                  listingDrafts: [
                    {
                      id: "draft-1",
                      title: "The North Face Black Nuptse Puffer Jacket",
                      description: "Black Nuptse puffer jacket.",
                      recommendedPriceCents: null,
                    },
                  ],
                }
              : null,
        ),
        update: vi.fn(async () => ({})),
      },
      listingDraft: {
        update: vi.fn(async () => ({})),
      },
      priceComp: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        createMany: vi.fn(async ({ data }: { data: unknown[] }) => {
          createdRows.push(...data);
          return { count: data.length };
        }),
        findMany: vi.fn(async () => createdRows),
      },
      compSearchRun: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "run-1", ...data })),
      },
    };

    const result = await runCompFetch(prisma as never, "item-1", "seller-1", {
      sources: [source],
    });

    expect(source.fetchComps).toHaveBeenCalledTimes(1);
    expect(prisma.compSearchRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inventoryItemId: "item-1",
        status: "auto_priced",
        sourceCount: 1,
        fetchedCount: 6,
        acceptedCount: 5,
        queries: expect.anything(),
        sourceErrors: [],
      }),
    });
    expect(createdRows).toHaveLength(6);
    expect(createdRows).toContainEqual(
      expect.objectContaining({
        title: "Nike Dunk Low Panda Size 10",
        usedInPricing: false,
        ignoredAsOutlier: true,
      }),
    );
    expect(prisma.inventoryItem.update).toHaveBeenCalledWith({
      where: { id: "item-1" },
      data: { recommendedPriceCents: result.summary.recommendedListCents },
    });
    expect(prisma.listingDraft.update).toHaveBeenCalledWith({
      where: { id: "draft-1" },
      data: { recommendedPriceCents: result.summary.recommendedListCents },
    });
    expect(result.status).toBe("auto_priced");
    expect(result.accepted).toBe(5);
    expect(result.rejected).toBe(1);
  });

  it("is a no-op for an item that does not belong to the seller", async () => {
    const source: CompSource = {
      id: "test-source",
      displayName: "Test source",
      sold: true,
      resultKind: "sold_comps",
      isEnabled: () => true,
      fetchComps: vi.fn(async () => [comp(1)]),
    };

    const prisma = {
      inventoryItem: {
        // Scoped lookup: a foreign seller's id never resolves this item.
        findFirst: vi.fn(
          async ({ where }: { where: { id: string; sellerId: string } }) =>
            where.id === "item-1" && where.sellerId === "owner"
              ? { id: "item-1", productName: "x", listingDrafts: [] }
              : null,
        ),
        update: vi.fn(async () => ({})),
      },
      listingDraft: { update: vi.fn(async () => ({})) },
      priceComp: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        createMany: vi.fn(async () => ({ count: 0 })),
        findMany: vi.fn(async () => []),
      },
      compSearchRun: { create: vi.fn(async () => ({ id: "run-1" })) },
    };

    const result = await runCompFetch(prisma as never, "item-1", "attacker", {
      sources: [source],
    });

    expect(result.status).toBe("error");
    expect(result.sourceErrors).toEqual([
      { source: "sello", message: "Item not found." },
    ]);
    expect(source.fetchComps).not.toHaveBeenCalled();
    expect(prisma.priceComp.deleteMany).not.toHaveBeenCalled();
    expect(prisma.priceComp.createMany).not.toHaveBeenCalled();
    expect(prisma.compSearchRun.create).not.toHaveBeenCalled();
  });
});
