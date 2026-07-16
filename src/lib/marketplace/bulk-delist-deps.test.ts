import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  executeEbayDelist: vi.fn(),
  executeStockXDelist: vi.fn(),
}));

vi.mock("./delist-handler", async (orig) => {
  const actual = await orig<typeof import("./delist-handler")>();
  return {
    ...actual,
    executeEbayDelist: mocks.executeEbayDelist,
    executeStockXDelist: mocks.executeStockXDelist,
  };
});
vi.mock("./adapters/ebay/config", async (orig) => {
  const actual = await orig<typeof import("./adapters/ebay/config")>();
  return { ...actual, getEbayEnvironment: () => "sandbox" };
});

import { defaultBulkDelistDeps, defaultBulkStockXDelistDeps } from "./bulk-delist";
import { EbayIntegrationError, ebayErrorCodes } from "./adapters/ebay/errors";
import { StockXIntegrationError, stockxErrorCodes } from "./adapters/stockx/errors";

const ENV = {} as Record<string, string | undefined>;

function prismaFake(opts: {
  owned?: boolean;
  connected?: boolean;
  listing?: {
    status: string;
    externalOfferId: string | null;
    externalListingId: string | null;
    publishAttempts?: Array<{ status: string; code: string }>;
  } | null;
} = {}) {
  return {
    inventoryItem: {
      findFirst: vi.fn(async () => (opts.owned === false ? null : { id: "item-1" })),
    },
    marketplaceListing: {
      findFirst: vi.fn(async () =>
        opts.listing === undefined ? null : opts.listing,
      ),
    },
    marketplaceConnection: {
      findUnique: vi.fn(async () => (opts.connected === false ? null : { id: "conn-1" })),
    },
  };
}

const live = {
  status: "LISTED",
  externalOfferId: "off-1",
  externalListingId: "list-1",
  publishAttempts: [] as Array<{ status: string; code: string }>,
};

beforeEach(() => vi.clearAllMocks());

describe("defaultBulkDelistDeps.preflightItem", () => {
  it("rejects an item the seller does not own", async () => {
    const deps = defaultBulkDelistDeps(prismaFake({ owned: false }) as never, ENV);
    expect((await deps.preflightItem({ userId: "u1", itemId: "item-1" })).status).toBe(
      "rejected",
    );
  });

  it("uses active account scope before listing classification", async () => {
    const prisma = prismaFake({ owned: false });
    const deps = defaultBulkDelistDeps(prisma as never, ENV);
    const result = await deps.preflightItem({
      userId: "member-1",
      accountId: "acc-1",
      itemId: "item-1",
    });

    expect(result.status).toBe("rejected");
    expect(prisma.inventoryItem.findFirst).toHaveBeenCalledWith({
      where: { id: "item-1", accountId: "acc-1" },
      select: { id: true },
    });
    expect(prisma.marketplaceListing.findFirst).not.toHaveBeenCalled();
  });

  it("reports not_listed when there is no eBay listing", async () => {
    const deps = defaultBulkDelistDeps(prismaFake({ listing: null }) as never, ENV);
    expect((await deps.preflightItem({ userId: "u1", itemId: "item-1" })).status).toBe(
      "not_listed",
    );
  });

  it("reports already_ended for a delisted listing", async () => {
    const deps = defaultBulkDelistDeps(
      prismaFake({ listing: { ...live, status: "DELISTED" } }) as never,
      ENV,
    );
    expect((await deps.preflightItem({ userId: "u1", itemId: "item-1" })).status).toBe(
      "already_ended",
    );
  });

  it("reports in_flight when a delist is already running", async () => {
    const deps = defaultBulkDelistDeps(
      prismaFake({
        listing: {
          ...live,
          publishAttempts: [{ status: "RUNNING", code: "EBAY_DELIST_STARTED" }],
        },
      }) as never,
      ENV,
    );
    expect((await deps.preflightItem({ userId: "u1", itemId: "item-1" })).status).toBe(
      "in_flight",
    );
  });

  it("reports eligible for a live listing with stored eBay ids", async () => {
    const deps = defaultBulkDelistDeps(prismaFake({ listing: live }) as never, ENV);
    expect((await deps.preflightItem({ userId: "u1", itemId: "item-1" })).status).toBe(
      "eligible",
    );
  });
});

describe("defaultBulkDelistDeps.executeItem", () => {
  const args = { userId: "u1", itemId: "item-1", bulkRunId: "run-1" };

  it("maps a successful delist to an ended result", async () => {
    mocks.executeEbayDelist.mockResolvedValue({ ok: true, status: "delisted" });
    const deps = defaultBulkDelistDeps(prismaFake() as never, ENV);
    expect((await deps.executeItem(args)).status).toBe("ended");
  });

  it("passes active account scope and acting user separately to executeEbayDelist", async () => {
    mocks.executeEbayDelist.mockResolvedValue({ ok: true, status: "delisted" });
    const deps = defaultBulkDelistDeps(prismaFake() as never, ENV);
    await deps.executeItem({
      userId: "member-1",
      accountId: "acc-1",
      itemId: "item-1",
      bulkRunId: "run-1",
    });

    expect(mocks.executeEbayDelist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "member-1",
        accountId: "acc-1",
        inventoryItemId: "item-1",
        confirmLiveDelist: true,
      }),
    );
  });

  it("skips safely when the listing is already ended or not live (409 precondition)", async () => {
    mocks.executeEbayDelist.mockRejectedValue(
      new EbayIntegrationError(
        ebayErrorCodes.delistFailed,
        "This eBay listing is already marked delisted.",
        409,
      ),
    );
    const deps = defaultBulkDelistDeps(prismaFake() as never, ENV);
    const out = await deps.executeItem(args);
    expect(out.status).toBe("skipped");
  });

  it("sanitizes a raw provider/DB failure into a safe failed result", async () => {
    mocks.executeEbayDelist.mockRejectedValue(
      new Error('PrismaClientKnownRequestError: Authorization: Bearer secret.token {"errors":[]}'),
    );
    const deps = defaultBulkDelistDeps(prismaFake() as never, ENV);
    const out = await deps.executeItem(args);
    expect(out.status).toBe("failed");
    expect(out.retrySafe).toBe(true);
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("secret.token");
    expect(serialized).not.toContain("Prisma");
    expect(serialized).not.toMatch(/\{"errors"/);
  });
});

describe("defaultBulkStockXDelistDeps.preflightItem", () => {
  it("rejects out-of-account items before StockX listing lookup", async () => {
    const prisma = prismaFake({ owned: false });
    const deps = defaultBulkStockXDelistDeps(prisma as never, ENV);

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
    expect(prisma.marketplaceListing.findFirst).not.toHaveBeenCalled();
  });

  it("rejects when the active account has no StockX seller connection", async () => {
    const prisma = prismaFake({ connected: false });
    const deps = defaultBulkStockXDelistDeps(prisma as never, ENV);

    const out = await deps.preflightItem({
      userId: "member-1",
      accountId: "acc-1",
      itemId: "item-1",
    });

    expect(out.status).toBe("rejected");
    expect(prisma.marketplaceListing.findFirst).not.toHaveBeenCalled();
  });

  it("reports eligible only for active StockX listings with an external listing id", async () => {
    const deps = defaultBulkStockXDelistDeps(
      prismaFake({
        listing: {
          status: "LISTING",
          externalOfferId: null,
          externalListingId: "sx-1",
          publishAttempts: [],
        },
      }) as never,
      ENV,
    );

    expect((await deps.preflightItem({ userId: "u1", accountId: "acc-1", itemId: "item-1" })).status).toBe("eligible");
  });

  it("treats already-ended StockX listings as safe", async () => {
    const deps = defaultBulkStockXDelistDeps(
      prismaFake({
        listing: {
          status: "ENDED",
          externalOfferId: null,
          externalListingId: "sx-1",
          publishAttempts: [],
        },
      }) as never,
      ENV,
    );

    expect((await deps.preflightItem({ userId: "u1", accountId: "acc-1", itemId: "item-1" })).status).toBe("already_ended");
  });

  it("reports StockX delist jobs already in flight", async () => {
    const deps = defaultBulkStockXDelistDeps(
      prismaFake({
        listing: {
          status: "LISTED",
          externalOfferId: null,
          externalListingId: "sx-1",
          publishAttempts: [{ status: "RUNNING", code: "STOCKX_DELIST_STARTED" }],
        },
      }) as never,
      ENV,
    );

    expect((await deps.preflightItem({ userId: "u1", accountId: "acc-1", itemId: "item-1" })).status).toBe("in_flight");
  });
});

describe("defaultBulkStockXDelistDeps.executeItem", () => {
  const args = { userId: "member-1", accountId: "acc-1", itemId: "item-1", bulkRunId: "run-1" };

  it("routes StockX bulk delist through the canonical StockX delist handler", async () => {
    mocks.executeStockXDelist.mockResolvedValue({ ok: true, status: "delisted" });
    const deps = defaultBulkStockXDelistDeps(prismaFake() as never, ENV);

    const out = await deps.executeItem(args);

    expect(out.status).toBe("ended");
    expect(mocks.executeStockXDelist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "member-1",
        accountId: "acc-1",
        inventoryItemId: "item-1",
        confirmLiveDelist: true,
      }),
    );
  });

  it("skips safely when StockX says the listing is already ended or not live", async () => {
    mocks.executeStockXDelist.mockRejectedValue(
      new StockXIntegrationError(
        stockxErrorCodes.delistFailed,
        "This StockX listing is already delisted.",
        409,
      ),
    );
    const deps = defaultBulkStockXDelistDeps(prismaFake() as never, ENV);

    const out = await deps.executeItem(args);

    expect(out.status).toBe("skipped");
    expect(JSON.stringify(out)).not.toContain("Bearer");
  });
});
