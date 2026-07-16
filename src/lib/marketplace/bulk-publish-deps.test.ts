import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  executePublish: vi.fn(),
  preflightEbayListing: vi.fn(),
}));

vi.mock("./publish-handler", async (orig) => {
  const actual = await orig<typeof import("./publish-handler")>();
  return { ...actual, executePublish: mocks.executePublish };
});
vi.mock("./adapters/ebay/preflight", async (orig) => {
  const actual = await orig<typeof import("./adapters/ebay/preflight")>();
  return { ...actual, preflightEbayListing: mocks.preflightEbayListing };
});
vi.mock("./adapters/ebay/config", async (orig) => {
  const actual = await orig<typeof import("./adapters/ebay/config")>();
  return { ...actual, getEbayEnvironment: () => "sandbox" };
});

import { defaultBulkPublishDeps, defaultBulkStockXPublishDeps } from "./bulk-publish";
import { EbayIntegrationError, ebayErrorCodes } from "./adapters/ebay/errors";
import { StockXIntegrationError, stockxErrorCodes } from "./adapters/stockx/errors";

const ENV = { EBAY_SANDBOX_PUBLISH_ENABLED: "true" } as Record<string, string | undefined>;
const STOCKX_ENV = {
  STOCKX_API_ENABLED: "true",
  STOCKX_LISTING_ENABLED: "true",
  STOCKX_CLIENT_ID: "client-id",
  STOCKX_CLIENT_SECRET: "client-secret",
  STOCKX_REDIRECT_URI: "https://sello.wtf/api/marketplaces/stockx/callback",
  STOCKX_TOKEN_ENCRYPTION_KEY: "test-encryption-key",
  STOCKX_OAUTH_STATE_SECRET: "x".repeat(40),
  STOCKX_API_KEY: "api-key",
} as Record<string, string | undefined>;

function prismaFake(opts: {
  owned?: boolean;
  listing?: { status: string; externalListingId: string | null } | null;
} = {}) {
  return {
    inventoryItem: {
      findFirst: vi.fn(async () => (opts.owned === false ? null : { id: "item-1" })),
    },
    marketplaceListing: {
      findFirst: vi.fn(async () => opts.listing ?? null),
    },
  };
}

function stockxPrismaFake(opts: {
  owned?: boolean;
  connected?: boolean;
  listing?: {
    status: string;
    externalListingId: string | null;
    publishAttempts?: Array<{ status: string; code: string }>;
  } | null;
  draft?: {
    selectedMarketplaces?: string[];
    stockxProductId?: string | null;
    stockxVariantId?: string | null;
    marketplaceDrafts?: unknown;
    recommendedPriceCents?: number | null;
  };
  quantityAvailable?: number;
  condition?: string;
  recommendedPriceCents?: number | null;
} = {}) {
  const draft = opts.draft;
  const stockxProductId =
    draft && "stockxProductId" in draft ? (draft.stockxProductId ?? null) : "product-1";
  const stockxVariantId =
    draft && "stockxVariantId" in draft ? (draft.stockxVariantId ?? null) : "variant-1";
  return {
    inventoryItem: {
      findFirst: vi.fn(async () => {
        if (opts.owned === false) return null;
        return {
          id: "item-1",
          productName: "Jordan 1",
          condition: opts.condition ?? "new_with_tags",
          quantityAvailable: opts.quantityAvailable ?? 1,
          recommendedPriceCents: opts.recommendedPriceCents ?? 12000,
          listingDrafts: [
            {
              title: "Jordan 1",
              recommendedPriceCents: opts.draft?.recommendedPriceCents ?? 12000,
              selectedMarketplaces: opts.draft?.selectedMarketplaces ?? ["stockx"],
              stockxProductId,
              stockxVariantId,
              marketplaceDrafts: opts.draft?.marketplaceDrafts ?? {
                stockx: { size: "10" },
              },
            },
          ],
        };
      }),
    },
    marketplaceConnection: {
      findUnique: vi.fn(async () => (opts.connected === false ? null : { id: "conn-1" })),
    },
    marketplaceListing: {
      findFirst: vi.fn(async () => opts.listing ?? null),
    },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("defaultBulkPublishDeps.preflightItem", () => {
  it("rejects an item the seller does not own (no readiness call)", async () => {
    const prisma = prismaFake({ owned: false });
    const deps = defaultBulkPublishDeps(prisma as never, ENV);

    const out = await deps.preflightItem({ userId: "user-1", itemId: "item-1" });

    expect(out.status).toBe("rejected");
    expect(mocks.preflightEbayListing).not.toHaveBeenCalled();
  });

  it("uses active account scope before readiness checks", async () => {
    const prisma = prismaFake({ owned: false });
    const deps = defaultBulkPublishDeps(prisma as never, ENV);

    const out = await deps.preflightItem({
      userId: "member-1",
      accountId: "acc-1",
      itemId: "item-1",
    });

    expect(out.status).toBe("rejected");
    expect(prisma.inventoryItem.findFirst).toHaveBeenCalledWith({
      where: { id: "item-1", accountId: "acc-1" },
      select: { id: true },
    });
    expect(mocks.preflightEbayListing).not.toHaveBeenCalled();
  });

  it("skips an item that already has a live eBay listing id (no readiness call)", async () => {
    const prisma = prismaFake({ listing: { status: "NOT_LISTED", externalListingId: "1100" } });
    const deps = defaultBulkPublishDeps(prisma as never, ENV);

    const out = await deps.preflightItem({ userId: "user-1", itemId: "item-1" });

    expect(out.status).toBe("skipped");
    expect(mocks.preflightEbayListing).not.toHaveBeenCalled();
  });

  it("skips an item whose listing is in a live/in-flight status", async () => {
    const prisma = prismaFake({ listing: { status: "LISTED", externalListingId: null } });
    const deps = defaultBulkPublishDeps(prisma as never, ENV);

    expect((await deps.preflightItem({ userId: "user-1", itemId: "item-1" })).status).toBe("skipped");
  });

  it("returns ready when ownership holds and readiness passes", async () => {
    const prisma = prismaFake({ listing: null });
    mocks.preflightEbayListing.mockResolvedValue({ ready: true, missing: [] });
    const deps = defaultBulkPublishDeps(prisma as never, ENV);

    expect((await deps.preflightItem({ userId: "user-1", itemId: "item-1" })).status).toBe("ready");
  });

  it("returns needs_details with friendly missing labels when readiness fails", async () => {
    const prisma = prismaFake({ listing: null });
    mocks.preflightEbayListing.mockResolvedValue({ ready: false, missing: ["title", "ebay_aspects"] });
    const deps = defaultBulkPublishDeps(prisma as never, ENV);

    const out = await deps.preflightItem({ userId: "user-1", itemId: "item-1" });
    expect(out.status).toBe("needs_details");
    expect(out.missing).toEqual(["Title", "Item specifics"]);
  });
});

describe("defaultBulkPublishDeps.executeItem", () => {
  const args = { userId: "user-1", itemId: "item-1", bulkRunId: "run-1" };

  it("maps a published outcome to a published result with the listing id", async () => {
    mocks.executePublish.mockResolvedValue({ outcome: { status: "published" }, listingId: "L-1" });
    const deps = defaultBulkPublishDeps(prismaFake() as never, ENV);

    const out = await deps.executeItem(args);
    expect(out).toMatchObject({ status: "published", externalListingId: "L-1" });
    expect(mocks.executePublish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        accountId: undefined,
        inventoryItemId: "item-1",
        marketplace: "ebay",
        bulkRunId: "run-1",
      }),
    );
  });

  it("passes active account scope and acting user separately to executePublish", async () => {
    mocks.executePublish.mockResolvedValue({ outcome: { status: "published" }, listingId: "L-1" });
    const deps = defaultBulkPublishDeps(prismaFake() as never, ENV);

    await deps.executeItem({
      userId: "member-1",
      accountId: "acc-1",
      itemId: "item-1",
      bulkRunId: "run-1",
    });

    expect(mocks.executePublish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "member-1",
        accountId: "acc-1",
        inventoryItemId: "item-1",
        marketplace: "ebay",
        bulkRunId: "run-1",
      }),
    );
  });

  it("maps a non-published (gate disabled) outcome to a safe skipped result", async () => {
    mocks.executePublish.mockResolvedValue({ outcome: { status: "not_enabled" } });
    const deps = defaultBulkPublishDeps(prismaFake() as never, ENV);

    const out = await deps.executeItem(args);
    expect(out.status).toBe("skipped");
    expect(out.message).toMatch(/isn.t enabled/i);
  });

  it("maps an already-published error to a safe skipped result", async () => {
    mocks.executePublish.mockRejectedValue(
      new EbayIntegrationError(ebayErrorCodes.alreadyPublished, "dup", 409),
    );
    const deps = defaultBulkPublishDeps(prismaFake() as never, ENV);

    const out = await deps.executeItem(args);
    expect(out.status).toBe("skipped");
    expect(out.message).toMatch(/already listed/i);
  });

  it("maps a readiness failure to needs_details", async () => {
    mocks.executePublish.mockRejectedValue(
      new EbayIntegrationError(ebayErrorCodes.readinessFailed, "not ready", 422),
    );
    const deps = defaultBulkPublishDeps(prismaFake() as never, ENV);

    expect((await deps.executeItem(args)).status).toBe("needs_details");
  });

  it("reports the exact missing fields on a readiness failure", async () => {
    mocks.executePublish.mockRejectedValue(
      new EbayIntegrationError(ebayErrorCodes.readinessFailed, "not ready", 422, {
        missing: ["ebay_size", "title"],
      }),
    );
    const deps = defaultBulkPublishDeps(prismaFake() as never, ENV);

    const out = await deps.executeItem(args);
    expect(out.status).toBe("needs_details");
    expect(out.missing).toEqual(["Size", "Title"]);
    expect(out.message).toMatch(/size/i);
  });

  it("surfaces a safe specific reason (not a flat generic) for a typed failure", async () => {
    mocks.executePublish.mockRejectedValue(
      new EbayIntegrationError(ebayErrorCodes.apiFailed, "eBay rejected the listing details.", 502),
    );
    const deps = defaultBulkPublishDeps(prismaFake() as never, ENV);

    const out = await deps.executeItem(args);
    expect(out.status).toBe("failed");
    expect(out.retrySafe).toBe(true);
    expect(out.message).toBe("eBay rejected the listing details.");
  });

  it("sanitizes a raw provider/DB error into a generic failed result (no leak)", async () => {
    mocks.executePublish.mockRejectedValue(
      new Error('PrismaClientKnownRequestError: Authorization: Bearer secret.token {"errors":[]}'),
    );
    const deps = defaultBulkPublishDeps(prismaFake() as never, ENV);

    const out = await deps.executeItem(args);
    expect(out.status).toBe("failed");
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("secret.token");
    expect(serialized).not.toContain("Prisma");
    expect(serialized).not.toMatch(/\{"errors"/);
  });
});

describe("defaultBulkStockXPublishDeps.preflightItem", () => {
  it("rejects out-of-account items before connection or duplicate checks", async () => {
    const prisma = stockxPrismaFake({ owned: false });
    const deps = defaultBulkStockXPublishDeps(prisma as never, STOCKX_ENV);

    const out = await deps.preflightItem({
      userId: "member-1",
      accountId: "acc-1",
      itemId: "item-1",
    });

    expect(out.status).toBe("rejected");
    expect(prisma.inventoryItem.findFirst).toHaveBeenCalledWith({
      where: { id: "item-1", accountId: "acc-1" },
      include: { listingDrafts: { orderBy: { updatedAt: "desc" }, take: 1 } },
    });
    expect(prisma.marketplaceConnection.findUnique).not.toHaveBeenCalled();
    expect(prisma.marketplaceListing.findFirst).not.toHaveBeenCalled();
  });

  it("returns ready only when StockX OAuth, exact match, price, quantity, and target are present", async () => {
    const deps = defaultBulkStockXPublishDeps(stockxPrismaFake() as never, STOCKX_ENV);

    const out = await deps.preflightItem({
      userId: "seller-1",
      accountId: "acc-1",
      itemId: "item-1",
    });

    expect(out).toEqual({ status: "ready" });
  });

  it("blocks disconnected, unmatched, unpriced, zero-quantity StockX items with friendly labels", async () => {
    const deps = defaultBulkStockXPublishDeps(
      stockxPrismaFake({
        connected: false,
        quantityAvailable: 0,
        draft: {
          selectedMarketplaces: [],
          stockxProductId: null,
          stockxVariantId: null,
          marketplaceDrafts: { stockx: {} },
          recommendedPriceCents: 0,
        },
      }) as never,
      STOCKX_ENV,
    );

    const out = await deps.preflightItem({ userId: "seller-1", accountId: "acc-1", itemId: "item-1" });

    expect(out.status).toBe("needs_details");
    expect(out.missing).toEqual(
      expect.arrayContaining([
        "StockX seller connection",
        "Exact StockX product",
        "Exact StockX size/variant",
        "StockX marketplace selection",
        "StockX size label",
        "Price",
        "Quantity",
      ]),
    );
  });

  it("skips duplicate StockX listings and in-flight StockX listing attempts", async () => {
    const listed = defaultBulkStockXPublishDeps(
      stockxPrismaFake({ listing: { status: "LISTED", externalListingId: "sx-1" } }) as never,
      STOCKX_ENV,
    );
    const inFlight = defaultBulkStockXPublishDeps(
      stockxPrismaFake({
        listing: {
          status: "FAILED",
          externalListingId: null,
          publishAttempts: [{ status: "RUNNING", code: "STOCKX_LISTING_STARTED" }],
        },
      }) as never,
      STOCKX_ENV,
    );

    expect((await listed.preflightItem({ userId: "seller-1", accountId: "acc-1", itemId: "item-1" })).status).toBe("skipped");
    expect((await inFlight.preflightItem({ userId: "seller-1", accountId: "acc-1", itemId: "item-1" })).status).toBe("skipped");
  });
});

describe("defaultBulkStockXPublishDeps.executeItem", () => {
  const args = { userId: "seller-1", accountId: "acc-1", itemId: "item-1", bulkRunId: "run-1" };

  it("routes StockX bulk execution through the canonical publish handler", async () => {
    mocks.executePublish.mockResolvedValue({
      outcome: { status: "submitted" },
      listingId: "stockx-listing-1",
    });
    const deps = defaultBulkStockXPublishDeps(stockxPrismaFake() as never, STOCKX_ENV);

    const out = await deps.executeItem(args);

    expect(out).toMatchObject({
      status: "published",
      externalListingId: "stockx-listing-1",
    });
    expect(mocks.executePublish).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "seller-1",
        accountId: "acc-1",
        inventoryItemId: "item-1",
        marketplace: "stockx",
        bulkRunId: "run-1",
        confirmLivePublish: true,
      }),
    );
  });

  it("maps StockX readiness failures to safe missing labels", async () => {
    mocks.executePublish.mockRejectedValue(
      new StockXIntegrationError(
        stockxErrorCodes.listingReadinessFailed,
        "not ready",
        422,
        { missing: ["stockx_variant_match", "price"] },
      ),
    );
    const deps = defaultBulkStockXPublishDeps(stockxPrismaFake() as never, STOCKX_ENV);

    const out = await deps.executeItem(args);

    expect(out.status).toBe("needs_details");
    expect(out.missing).toEqual(["Exact StockX size/variant", "Price"]);
    expect(JSON.stringify(out)).not.toContain("STOCKX_CLIENT_SECRET");
  });
});
