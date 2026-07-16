import { describe, expect, it, vi } from "vitest";

import type { InventoryStatus, PublishAttemptStatus } from "@/generated/prisma/client";

import { EbayIntegrationError, ebayErrorCodes } from "./adapters/ebay/errors";
import { StockXIntegrationError, stockxErrorCodes } from "./adapters/stockx/errors";
import {
  executeEbayDelist,
  executeStockXDelist,
  type DelistPrismaLike,
} from "./delist-handler";

type FakeListing = {
  id: string;
  inventoryItemId: string;
  marketplace: "ebay" | "stockx";
  environment: string;
  status: string;
  sku: string | null;
  externalOfferId: string | null;
  externalListingId: string | null;
  lastError: string | null;
  publishAttempts: Array<{ status: PublishAttemptStatus; code: string }>;
};

type FakeState = {
  listing: FakeListing | null;
  otherMarketplaceStatuses: string[];
  itemLookups: Array<Record<string, unknown>>;
  attempts: Array<{
    id: string;
    status: PublishAttemptStatus;
    code: string;
    reason: string | null;
    idempotencyKey: string | null;
  }>;
  events: Array<{ kind: string; data: Record<string, unknown> }>;
  updates: Array<{ where: { id: string }; data: Record<string, unknown> }>;
  inventoryUpdates: Array<{ where: { id: string }; data: Record<string, unknown> }>;
};

function createPrisma(opts: {
  itemStatus?: InventoryStatus;
  listing?: Partial<FakeListing> | null;
  otherMarketplaceStatuses?: string[];
  rejectActiveAttempt?: boolean;
}): DelistPrismaLike & { _state: FakeState } {
  const state: FakeState = {
    listing:
      opts.listing === null
        ? null
        : {
            id: "listing-1",
            inventoryItemId: "item-1",
            marketplace: "ebay",
            environment: "sandbox",
            status: "LISTED",
            sku: "percs_item-1",
            externalOfferId: "offer-1",
            externalListingId: "ebay-listing-1",
            lastError: null,
            publishAttempts: [],
            ...opts.listing,
          },
    otherMarketplaceStatuses: opts.otherMarketplaceStatuses ?? [],
    itemLookups: [],
    attempts: [],
    events: [],
    updates: [],
    inventoryUpdates: [],
  };

  return {
    _state: state,
    inventoryItem: {
      async findFirst({ where }) {
        state.itemLookups.push(where);
        if (where.id !== "item-1") return null;
        if (where.accountId && where.accountId !== "acc-1") return null;
        if (!where.accountId && where.sellerId !== "user-1") return null;
        return { id: "item-1", status: opts.itemStatus ?? "LISTED" };
      },
      async update({ where, data }) {
        state.inventoryUpdates.push({ where, data });
        return { id: where.id };
      },
    },
    marketplaceListing: {
      async findFirst({ where }) {
        if (
          state.listing &&
          where.inventoryItemId === state.listing.inventoryItemId &&
          where.marketplace === state.listing.marketplace &&
          where.environment === state.listing.environment
        ) {
          return state.listing;
        }
        return null;
      },
      async update({ where, data }) {
        state.updates.push({ where, data });
        if (state.listing && state.listing.id === where.id) {
          if (typeof data.status === "string") state.listing.status = data.status;
          if (typeof data.lastError === "string" || data.lastError === null) {
            state.listing.lastError = data.lastError as string | null;
          }
        }
        return { id: where.id };
      },
      async findMany() {
        return [
          ...(state.listing ? [{ status: state.listing.status }] : []),
          ...state.otherMarketplaceStatuses.map((status) => ({ status })),
        ];
      },
    },
    publishAttempt: {
      async create({ data }) {
        // Simulate the partial unique index rejecting a duplicate active attempt.
        if (opts.rejectActiveAttempt && data.status === "RUNNING") {
          throw Object.assign(
            new Error(
              "Unique constraint failed on the fields: (`marketplaceListingId`,`idempotencyKey`)",
            ),
            { code: "P2002" },
          );
        }
        const attempt = {
          id: `attempt-${state.attempts.length + 1}`,
          status: data.status,
          code: data.code,
          reason: data.reason ?? null,
          idempotencyKey: data.idempotencyKey ?? null,
        };
        state.attempts.push(attempt);
        state.listing?.publishAttempts.push(attempt);
        return { id: attempt.id };
      },
      async update({ where, data }) {
        const attempt = state.attempts.find((a) => a.id === where.id);
        if (!attempt) throw new Error("attempt not found");
        if (data.status) attempt.status = data.status;
        if (data.code) attempt.code = data.code;
        if ("reason" in data) attempt.reason = data.reason ?? null;
        return { id: where.id };
      },
    },
    marketplaceEvent: {
      async create({ data }) {
        state.events.push({
          kind: data.kind,
          data: data.data as Record<string, unknown>,
        });
        return { id: `event-${state.events.length}` };
      },
    },
  };
}

describe("executeEbayDelist", () => {
  const input = {
    userId: "user-1",
    inventoryItemId: "item-1",
    confirmLiveDelist: true,
  };

  it("requires explicit live delist confirmation", async () => {
    const prisma = createPrisma({});
    const delist = vi.fn();

    await expect(
      executeEbayDelist(prisma, { ...input, confirmLiveDelist: false }, delist),
    ).rejects.toMatchObject({ status: 400 });

    expect(delist).not.toHaveBeenCalled();
    expect(prisma._state.attempts).toHaveLength(0);
  });

  it("hides the path by rejecting when no published eBay listing exists", async () => {
    const prisma = createPrisma({ listing: null });
    const delist = vi.fn();

    await expect(executeEbayDelist(prisma, input, delist)).rejects.toMatchObject({
      status: 409,
    });

    expect(delist).not.toHaveBeenCalled();
  });

  it("creates a running delist attempt before the outbound eBay call", async () => {
    const prisma = createPrisma({});
    const delist = vi.fn().mockImplementation(async () => {
      expect(prisma._state.attempts[0]).toMatchObject({
        status: "RUNNING",
        code: "EBAY_DELIST_STARTED",
        idempotencyKey: "item-1:ebay:sandbox:delist",
      });
      return {
        status: "delisted",
        code: "EBAY_DELIST_SUCCEEDED",
        marketplace: "ebay",
        environment: "sandbox",
        offerId: "offer-1",
        listingId: "ebay-listing-1",
      };
    });

    await executeEbayDelist(prisma, input, delist);

    expect(delist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        inventoryItemId: "item-1",
        offerId: "offer-1",
      }),
    );
  });

  it("uses account scope for item lookup and passes it to the eBay adapter", async () => {
    const prisma = createPrisma({});
    const delist = vi.fn().mockResolvedValue({
      status: "delisted",
      code: "EBAY_DELIST_SUCCEEDED",
      marketplace: "ebay",
      environment: "sandbox",
      offerId: "offer-1",
      listingId: "ebay-listing-1",
    });

    await executeEbayDelist(
      prisma,
      { ...input, accountId: "acc-1" },
      delist,
    );

    expect(prisma._state.itemLookups[0]).toEqual({ id: "item-1", accountId: "acc-1" });
    expect(delist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        accountId: "acc-1",
        inventoryItemId: "item-1",
      }),
    );
  });

  it("marks the listing DELISTED and logs events only after eBay confirms success", async () => {
    const prisma = createPrisma({});

    const result = await executeEbayDelist(
      prisma,
      input,
      vi.fn().mockResolvedValue({
        status: "delisted",
        code: "EBAY_DELIST_SUCCEEDED",
        marketplace: "ebay",
        environment: "sandbox",
        offerId: "offer-1",
        listingId: "ebay-listing-1",
      }),
    );

    expect(result.status).toBe("delisted");
    expect(prisma._state.attempts[0]).toMatchObject({
      status: "SUCCEEDED",
      code: "EBAY_DELIST_SUCCEEDED",
    });
    expect(prisma._state.updates.at(-1)?.data).toMatchObject({
      status: "DELISTED",
      lastError: null,
    });
    expect(prisma._state.inventoryUpdates).toEqual([
      { where: { id: "item-1" }, data: { status: "DELISTED" } },
    ]);
    expect(prisma._state.events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["delist_started", "ebay_offer_withdrawn"]),
    );
  });

  it("keeps the master item LISTED when another marketplace channel remains active", async () => {
    const prisma = createPrisma({ otherMarketplaceStatuses: ["LISTED"] });

    await executeEbayDelist(
      prisma,
      input,
      vi.fn().mockResolvedValue({
        status: "delisted",
        code: "EBAY_DELIST_SUCCEEDED",
        marketplace: "ebay",
        environment: "sandbox",
        offerId: "offer-1",
        listingId: "ebay-listing-1",
      }),
    );

    expect(prisma._state.inventoryUpdates).toEqual([
      { where: { id: "item-1" }, data: { status: "LISTED" } },
    ]);
  });

  it("persists failure and leaves the listing published when eBay rejects delist", async () => {
    const prisma = createPrisma({});

    await expect(
      executeEbayDelist(
        prisma,
        input,
        vi.fn().mockRejectedValue(
          new EbayIntegrationError(
            ebayErrorCodes.delistFailed,
            "eBay could not end this listing.",
            502,
            { status: 400 },
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: ebayErrorCodes.delistFailed });

    expect(prisma._state.attempts[0]).toMatchObject({
      status: "FAILED",
      code: ebayErrorCodes.delistFailed,
      reason: "eBay could not end this listing.",
    });
    expect(prisma._state.listing?.status).toBe("LISTED");
    expect(prisma._state.listing?.lastError).toBe("eBay could not end this listing.");
    expect(prisma._state.events.some((e) => e.kind === "delist_failed")).toBe(true);
  });

  it("sanitizes a raw failure reason before persisting reason and lastError", async () => {
    const prisma = createPrisma({});

    await expect(
      executeEbayDelist(
        prisma,
        input,
        vi.fn().mockRejectedValue(
          new EbayIntegrationError(
            ebayErrorCodes.delistFailed,
            'eBay delist request failed: {"errors":[{"message":"Authorization: Bearer secret.token"}]}',
            502,
            { status: 400 },
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: ebayErrorCodes.delistFailed });

    // Raw eBay JSON / Bearer token replaced with the safe fallback.
    expect(prisma._state.attempts[0].reason).toBe("eBay could not end this listing.");
    expect(prisma._state.listing?.lastError).toBe("eBay could not end this listing.");
    const serialized = JSON.stringify(prisma._state);
    expect(serialized).not.toContain("Bearer");
    expect(serialized).not.toContain("secret.token");
    expect(serialized).not.toMatch(/\{"errors"/);
  });

  it("keeps an ambiguous eBay delist RUNNING and blocks a replay until reconciliation", async () => {
    const prisma = createPrisma({});
    const delist = vi.fn().mockRejectedValue(
      new EbayIntegrationError(
        ebayErrorCodes.delistFailed,
        "eBay delist timed out.",
        502,
        { status: 504 },
      ),
    );

    await expect(executeEbayDelist(prisma, input, delist)).rejects.toMatchObject({
      code: ebayErrorCodes.delistFailed,
    });
    expect(prisma._state.attempts[0]).toMatchObject({
      status: "RUNNING",
      code: "EBAY_DELIST_OUTCOME_UNKNOWN",
    });
    expect(prisma._state.listing).toMatchObject({
      status: "NEEDS_REVIEW",
      lastError:
        "eBay may have ended this listing. Reconcile it before retrying the delist.",
    });
    expect(prisma._state.events.some((event) => event.kind === "delist_outcome_unknown"))
      .toBe(true);

    await expect(executeEbayDelist(prisma, input, delist)).rejects.toMatchObject({
      status: 409,
    });
    expect(delist).toHaveBeenCalledTimes(1);
  });

  it("blocks duplicate delist while a delist attempt is running", async () => {
    const prisma = createPrisma({
      listing: { publishAttempts: [{ status: "RUNNING", code: "EBAY_DELIST_STARTED" }] },
    });
    const delist = vi.fn();

    await expect(executeEbayDelist(prisma, input, delist)).rejects.toMatchObject({
      status: 409,
    });

    expect(delist).not.toHaveBeenCalled();
  });

  it("maps a DB unique-constraint violation on the active attempt to a typed 409", async () => {
    const prisma = createPrisma({ rejectActiveAttempt: true });
    const delist = vi.fn();

    await expect(executeEbayDelist(prisma, input, delist)).rejects.toMatchObject({
      code: ebayErrorCodes.delistFailed,
      status: 409,
    });

    expect(delist).not.toHaveBeenCalled();
  });

  it("blocks already-delisted listings", async () => {
    const prisma = createPrisma({ listing: { status: "DELISTED" } });
    const delist = vi.fn();

    await expect(executeEbayDelist(prisma, input, delist)).rejects.toMatchObject({
      status: 409,
    });

    expect(delist).not.toHaveBeenCalled();
  });
});

describe("executeStockXDelist", () => {
  const input = {
    userId: "user-1",
    inventoryItemId: "item-1",
    confirmLiveDelist: true,
  };

  const stockxListing: Partial<FakeListing> = {
    marketplace: "stockx",
    environment: "production",
    status: "LISTED",
    externalOfferId: null,
    externalListingId: "stockx-listing-1",
  };

  it("requires explicit live StockX delist confirmation", async () => {
    const prisma = createPrisma({ listing: stockxListing });
    const delist = vi.fn();

    await expect(
      executeStockXDelist(
        prisma,
        { ...input, confirmLiveDelist: false },
        delist,
      ),
    ).rejects.toMatchObject({ status: 400 });

    expect(delist).not.toHaveBeenCalled();
    expect(prisma._state.attempts).toHaveLength(0);
  });

  it("creates a running delist attempt before the outbound StockX call", async () => {
    const prisma = createPrisma({ listing: stockxListing });
    const delist = vi.fn().mockImplementation(async () => {
      expect(prisma._state.attempts[0]).toMatchObject({
        status: "RUNNING",
        code: stockxErrorCodes.delistStarted,
        idempotencyKey: "item-1:stockx:production:delist",
      });
      return {
        status: "delisted",
        code: stockxErrorCodes.delistSucceeded,
        marketplace: "stockx",
        environment: "production",
        listingId: "stockx-listing-1",
        operationId: "op-1",
        operationStatus: "PENDING",
        operationUrl: null,
      };
    });

    await executeStockXDelist(prisma, input, delist);

    expect(delist).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: "user-1",
        inventoryItemId: "item-1",
        listingId: "stockx-listing-1",
      }),
    );
  });

  it("marks StockX listing DELISTED only after StockX confirms deactivate", async () => {
    const prisma = createPrisma({ listing: stockxListing });

    const result = await executeStockXDelist(
      prisma,
      input,
      vi.fn().mockResolvedValue({
        status: "delisted",
        code: stockxErrorCodes.delistSucceeded,
        marketplace: "stockx",
        environment: "production",
        listingId: "stockx-listing-1",
        operationId: "op-1",
        operationStatus: "PENDING",
        operationUrl: null,
      }),
    );

    expect(result.status).toBe("delisted");
    expect(prisma._state.attempts[0]).toMatchObject({
      status: "SUCCEEDED",
      code: stockxErrorCodes.delistSucceeded,
    });
    expect(prisma._state.updates.at(-1)?.data).toMatchObject({
      status: "DELISTED",
      lastError: null,
    });
    expect(prisma._state.inventoryUpdates).toEqual([
      { where: { id: "item-1" }, data: { status: "DELISTED" } },
    ]);
    expect(prisma._state.events.map((e) => e.kind)).toEqual(
      expect.arrayContaining(["delist_started", "stockx_listing_deactivated"]),
    );
  });

  it("persists failure and leaves the StockX listing published when deactivate fails", async () => {
    const prisma = createPrisma({ listing: stockxListing });

    await expect(
      executeStockXDelist(
        prisma,
        input,
        vi.fn().mockRejectedValue(
          new StockXIntegrationError(
            stockxErrorCodes.delistFailed,
            "StockX could not end this listing.",
            502,
            { status: 400 },
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: stockxErrorCodes.delistFailed });

    expect(prisma._state.attempts[0]).toMatchObject({
      status: "FAILED",
      code: stockxErrorCodes.delistFailed,
      reason: "StockX could not end this listing.",
    });
    expect(prisma._state.listing?.status).toBe("LISTED");
    expect(prisma._state.listing?.lastError).toBe("StockX could not end this listing.");
    expect(prisma._state.events.some((e) => e.kind === "delist_failed")).toBe(true);
  });

  it("keeps an ambiguous StockX delist RUNNING and blocks a replay until reconciliation", async () => {
    const prisma = createPrisma({ listing: stockxListing });
    const delist = vi.fn().mockRejectedValue(
      new StockXIntegrationError(
        stockxErrorCodes.delistFailed,
        "StockX delist timed out.",
        502,
        { status: 504 },
      ),
    );

    await expect(executeStockXDelist(prisma, input, delist)).rejects.toMatchObject({
      code: stockxErrorCodes.delistFailed,
    });
    expect(prisma._state.attempts[0]).toMatchObject({
      status: "RUNNING",
      code: "STOCKX_DELIST_OUTCOME_UNKNOWN",
    });
    expect(prisma._state.listing).toMatchObject({
      status: "NEEDS_REVIEW",
      lastError:
        "StockX may have ended this listing. Reconcile it before retrying the delist.",
    });
    expect(prisma._state.events.some((event) => event.kind === "delist_outcome_unknown"))
      .toBe(true);

    await expect(executeStockXDelist(prisma, input, delist)).rejects.toMatchObject({
      status: 409,
    });
    expect(delist).toHaveBeenCalledTimes(1);
  });

  it("blocks duplicate StockX delist while a delist attempt is running", async () => {
    const prisma = createPrisma({
      listing: {
        ...stockxListing,
        publishAttempts: [
          { status: "RUNNING", code: stockxErrorCodes.delistStarted },
        ],
      },
    });
    const delist = vi.fn();

    await expect(executeStockXDelist(prisma, input, delist)).rejects.toMatchObject({
      status: 409,
    });

    expect(delist).not.toHaveBeenCalled();
  });
});
