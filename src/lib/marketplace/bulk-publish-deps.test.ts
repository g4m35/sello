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

import { defaultBulkPublishDeps } from "./bulk-publish";
import { EbayIntegrationError, ebayErrorCodes } from "./adapters/ebay/errors";

const ENV = { EBAY_SANDBOX_PUBLISH_ENABLED: "true" } as Record<string, string | undefined>;

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

beforeEach(() => vi.clearAllMocks());

describe("defaultBulkPublishDeps.preflightItem", () => {
  it("rejects an item the seller does not own (no readiness call)", async () => {
    const prisma = prismaFake({ owned: false });
    const deps = defaultBulkPublishDeps(prisma as never, ENV);

    const out = await deps.preflightItem({ userId: "user-1", itemId: "item-1" });

    expect(out.status).toBe("rejected");
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
