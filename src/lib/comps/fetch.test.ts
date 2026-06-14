import { describe, expect, it, vi } from "vitest";

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
  it("persists source run metadata, stores accepted/rejected comps, and auto-fills high-confidence pricing", async () => {
    const createdRows: unknown[] = [];
    const source: CompSource = {
      id: "test-source",
      displayName: "Test source",
      sold: true,
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
        findUnique: vi.fn(async () => ({
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
        })),
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

    const result = await runCompFetch(prisma as never, "item-1", { sources: [source] });

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
});
