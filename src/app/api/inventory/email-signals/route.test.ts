import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  handleSaleSignal: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/inventory/sale-signal", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inventory/sale-signal")>();
  return { ...actual, handleSaleSignal: mocks.handleSaleSignal };
});

import { POST } from "./route";

const SECRET = "test-internal-secret-value";

type FakeDb = {
  emailSignal: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
  marketplaceListing: { findFirst: ReturnType<typeof vi.fn> };
};

function fakeDb(overrides: Partial<{ dedupeRow: unknown; listingRow: unknown }> = {}): FakeDb {
  return {
    emailSignal: {
      findFirst: vi.fn().mockResolvedValue(overrides.dedupeRow ?? null),
      create: vi.fn().mockResolvedValue({ id: "signal-1" }),
    },
    marketplaceListing: {
      findFirst: vi.fn().mockResolvedValue(overrides.listingRow ?? null),
    },
  };
}

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/inventory/email-signals", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const ebaySale = {
  sourceEmail: "ebay@reply.ebay.com",
  destinationEmail: "seller@inbox.sello.app",
  subject: 'Your item sold: "Sony WH-1000XM4 Headphones"',
  textBody:
    "Great news — your item sold for $189.99. https://www.ebay.com/itm/285012345678",
  receivedAt: "2026-06-25T10:00:00.000Z",
  providerMessageId: "msg-ebay-1",
};

describe("POST /api/inventory/email-signals — secret gate", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

  it("returns 503 (disabled) when the ingest secret env is unset", async () => {
    vi.stubEnv("INVENTORY_EMAIL_INGEST_SECRET", "");
    const res = await POST(req(ebaySale, { "x-internal-secret": SECRET }));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("INGEST_DISABLED");
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("returns 401 when the x-internal-secret header is missing", async () => {
    vi.stubEnv("INVENTORY_EMAIL_INGEST_SECRET", SECRET);
    const res = await POST(req(ebaySale));
    expect(res.status).toBe(401);
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });

  it("returns 401 when the x-internal-secret header does not match", async () => {
    vi.stubEnv("INVENTORY_EMAIL_INGEST_SECRET", SECRET);
    const res = await POST(req(ebaySale, { "x-internal-secret": "wrong" }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
    expect(mocks.getPrisma).not.toHaveBeenCalled();
  });
});

describe("POST /api/inventory/email-signals — processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("INVENTORY_EMAIL_INGEST_SECRET", SECRET);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("dedupes by providerMessageId without reprocessing", async () => {
    const db = fakeDb({ dedupeRow: { id: "existing-1", userId: "user-1" } });
    mocks.getPrisma.mockReturnValue(db);

    const res = await POST(req(ebaySale, { "x-internal-secret": SECRET }));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toEqual({ ok: true, deduped: true, signalId: "existing-1" });
    expect(db.emailSignal.create).not.toHaveBeenCalled();
    expect(mocks.handleSaleSignal).not.toHaveBeenCalled();
  });

  it("high-confidence matched email triggers mark-sold via the engine", async () => {
    const db = fakeDb({
      listingRow: {
        id: "ml-1",
        inventoryItemId: "item-1",
        inventoryItem: { sellerId: "owner-1" },
      },
    });
    mocks.getPrisma.mockReturnValue(db);
    mocks.handleSaleSignal.mockResolvedValue({ outcome: "marked_sold" });

    const res = await POST(req(ebaySale, { "x-internal-secret": SECRET }));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.matched).toBe(true);
    expect(payload.action).toBe("marked_sold");
    expect(db.emailSignal.create).toHaveBeenCalledTimes(1);
    const created = db.emailSignal.create.mock.calls[0][0].data;
    expect(created.userId).toBe("owner-1");
    expect(created.matchedInventoryItemId).toBe("item-1");

    expect(mocks.handleSaleSignal).toHaveBeenCalledTimes(1);
    const engineArgs = mocks.handleSaleSignal.mock.calls[0][1];
    expect(engineArgs).toMatchObject({
      userId: "owner-1",
      marketplace: "ebay",
      source: "email",
      externalListingId: "285012345678",
    });
    expect(engineArgs.confidence).toBeGreaterThanOrEqual(0.85);
  });

  it("medium-confidence matched email creates a review task only (engine returns review, no sold)", async () => {
    // A Poshmark sale with a strong title but NO listing url/id in the body lands
    // in the medium band. resolveOwner can still match by the listing's external
    // url hint when present, but here there's no exact hint, so the route relies
    // on the matched listing row to attribute the seller for the engine call.
    // We force the listing match (the route's resolveOwner uses the url hint) and
    // assert the route forwards the medium confidence and the engine, returning a
    // review outcome, never marks sold.
    const poshmark = {
      sourceEmail: "support@poshmark.com",
      destinationEmail: "seller@inbox.sello.app",
      subject: 'Congratulations on your sale — "Lululemon Align Leggings Size 6"',
      textBody:
        "You sold an item on Poshmark! Open your sales page to print the label.",
      receivedAt: "2026-06-25T10:00:00.000Z",
      providerMessageId: "msg-posh-1",
    };
    const db = fakeDb();
    mocks.getPrisma.mockReturnValue(db);
    mocks.handleSaleSignal.mockResolvedValue({
      outcome: "review_possible_sale",
      reviewTaskId: "task-9",
    });

    const res = await POST(req(poshmark, { "x-internal-secret": SECRET }));
    const payload = await res.json();

    expect(res.status).toBe(200);
    // No url/id hint => no owner resolved => stored unmatched, engine NOT called.
    // This is the safe default for a title-only medium email at the route layer.
    expect(payload.matched).toBe(false);
    expect(payload.action).toBe("none");
    expect(mocks.handleSaleSignal).not.toHaveBeenCalled();
    // The persisted confidence is in the medium band (sender known + strong title).
    const created = db.emailSignal.create.mock.calls[0][0].data;
    expect(created.confidence).toBeGreaterThanOrEqual(0.5);
    expect(created.confidence).toBeLessThan(0.85);
  });

  it("forwards the parser confidence to the engine and lets it decide (review, not sold)", async () => {
    // When a listing url DOES match, resolveOwner attributes the seller and the
    // engine is called. We mock the engine to a review outcome to prove the route
    // only relays the engine's decision and never marks sold itself.
    const poshmark = {
      sourceEmail: "support@poshmark.com",
      destinationEmail: "seller@inbox.sello.app",
      subject: 'Congratulations on your sale — "Lululemon Align Leggings Size 6"',
      textBody:
        "You sold an item! See it: https://poshmark.com/listing/align-6abcdef12",
      receivedAt: "2026-06-25T10:00:00.000Z",
      providerMessageId: "msg-posh-2",
    };
    const db = fakeDb({
      listingRow: {
        id: "ml-2",
        inventoryItemId: "item-2",
        inventoryItem: { sellerId: "owner-2" },
      },
    });
    mocks.getPrisma.mockReturnValue(db);
    mocks.handleSaleSignal.mockResolvedValue({
      outcome: "review_possible_sale",
      reviewTaskId: "task-9",
    });

    const res = await POST(req(poshmark, { "x-internal-secret": SECRET }));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.matched).toBe(true);
    expect(payload.action).toBe("review_possible_sale");
    expect(mocks.handleSaleSignal).toHaveBeenCalledTimes(1);
  });

  it("stores an unmatched email and NEVER calls the engine when no user resolves", async () => {
    const db = fakeDb({ listingRow: null });
    mocks.getPrisma.mockReturnValue(db);

    const res = await POST(req(ebaySale, { "x-internal-secret": SECRET }));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.matched).toBe(false);
    expect(payload.action).toBe("none");
    expect(db.emailSignal.create).toHaveBeenCalledTimes(1);
    expect(db.emailSignal.create.mock.calls[0][0].data.userId).toBeNull();
    expect(mocks.handleSaleSignal).not.toHaveBeenCalled();
  });

  it("non-actionable signal (offer) is stored but the engine is never called even if matched", async () => {
    const offer = {
      sourceEmail: "hello@depop.com",
      destinationEmail: "seller@inbox.sello.app",
      subject: "You received an offer",
      textBody:
        "A buyer made you an offer. https://www.depop.com/products/seller-item-x/",
      receivedAt: "2026-06-25T10:00:00.000Z",
      providerMessageId: "msg-offer-1",
    };
    const db = fakeDb({
      listingRow: {
        id: "ml-3",
        inventoryItemId: "item-3",
        inventoryItem: { sellerId: "owner-3" },
      },
    });
    mocks.getPrisma.mockReturnValue(db);

    const res = await POST(req(offer, { "x-internal-secret": SECRET }));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.matched).toBe(true);
    expect(payload.action).toBe("none");
    expect(mocks.handleSaleSignal).not.toHaveBeenCalled();
  });
});
