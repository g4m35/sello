import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/marketplace/adapters/ebay/config", () => ({ getEbayEnvironment: () => "production", getEbayConfig: () => ({ marketplaceId: "EBAY_US" }) }));
import { advanceOrderWindow, orderSignals, pollEbayOrders } from "./ebay-order-poller";
import { EBAY_FULFILLMENT_SCOPE } from "@/lib/marketplace/adapters/ebay/types";

function harness() {
  const connection = { id: "connection", accountId: "account", userId: "user", environment: "production", marketplace: "ebay", scopes: [EBAY_FULFILLMENT_SCOPE] };
  const job = { id: connection.id, status: "QUEUED", updatedAt: new Date(0), payload: { since: "2026-09-01T00:00:00.000Z", until: "2026-09-02T00:00:00.000Z", pendingEnds: [] as string[] } };
  const db = {
    marketplaceConnection: { findMany: vi.fn(async () => [connection]), findUnique: vi.fn(async () => connection) },
    marketplaceListing: { findFirst: vi.fn(async () => ({ id: "owned" })) },
    jobLog: {
      createMany: vi.fn(), findMany: vi.fn(async () => [structuredClone(job)]),
      updateMany: vi.fn(async ({ where, data }) => {
        if (!where.id) return { count: 0 };
        if (where.status !== job.status || where.updatedAt.getTime() !== job.updatedAt.getTime()) return { count: 0 };
        Object.assign(job, data); return { count: 1 };
      }),
    },
  };
  const page = { orders: [] as unknown[], next: undefined as string | undefined };
  const read = vi.fn(async () => page);
  const deps = {
    resolveUser: vi.fn(async () => ({ id: "user" })), entitlements: vi.fn(async () => ({ account: { id: "account" }, access: { ebayDelist: true } })),
    accessToken: vi.fn(async () => "token"), client: vi.fn(() => ({ getOrdersModifiedSince: read })),
    reconcile: vi.fn(async () => ({ outcome: "sold" as string, priorOutcome: "sold" as string | null })), notify: vi.fn(),
  };
  return { db, deps, job, connection, page, read, run: () => pollEbayOrders(db as never, deps as never) };
}
const order = (id: string) => ({ orderId: id, lastModifiedDate: "2026-09-01T01:00:00.000Z", orderPaymentStatus: "PAID", orderFulfillmentStatus: "NOT_STARTED", cancelStatus: { cancelState: "NONE_REQUESTED" }, lineItems: [{ lineItemId: "line", legacyItemId: id, quantity: 1 }] });

describe("eBay sale monitor", () => {
  it("does not guess paid, uncancelled or single quantity from missing fields", () => {
    expect(orderSignals({ orderId: "o", lineItems: [{ lineItemId: "l", legacyItemId: "e" }] }, { accountId: "a", actorUserId: "u", environment: "production" })).toMatchObject([{ paymentStatus: "UNKNOWN", cancelState: "UNKNOWN", quantity: 0 }]);
  });
  it("claims concurrent workers once", async () => {
    const h = harness(); await Promise.all([h.run(), h.run()]); expect(h.read).toHaveBeenCalledTimes(1);
  });
  it("never paginates a mutable result with an offset", async () => {
    const h = harness(); h.page.orders = Array.from({ length: 50 }, (_, i) => order(String(i))); h.page.next = "next";
    const first = await h.run(); expect(first.deferred).toBe(1); expect(h.deps.reconcile).not.toHaveBeenCalled();
    // The first order moves outside the old window. Read the narrowed window
    // again from zero, including the formerly 51st order; no offset skips it.
    h.page.orders = [order("formerly-51st")]; h.page.next = undefined;
    await h.run();
    expect(h.deps.reconcile).toHaveBeenCalledWith(h.db, expect.objectContaining({ externalListingId: "formerly-51st" }));
    expect(h.read.mock.calls.every((call) => (call as unknown as [unknown, { offset: number }])[1].offset === 0)).toBe(true);
    expect(h.job.payload.until).toBe("2026-09-02T00:00:00.000Z");
  });
  it("alerts the seller and does not advance an unsplittable overflow", async () => {
    const h = harness(); h.job.payload.since = "2026-09-01T23:59:59.500Z"; const original = structuredClone(h.job.payload);
    h.page.next = "next"; expect((await h.run()).failed).toBe(1);
    expect(h.job.payload).toEqual(original); expect(h.deps.notify).toHaveBeenCalledWith(h.db, expect.objectContaining({ accountId: "account", dedupeKey: expect.any(String) }));
  });
  it.each(["denied", "foreign", "scope"])("stops before token refresh when authorization is %s", async (reason) => {
    const h = harness();
    if (reason === "denied") h.deps.entitlements.mockResolvedValue({ account: { id: "account" }, access: { ebayDelist: false } });
    if (reason === "foreign") h.deps.entitlements.mockResolvedValue({ account: { id: "other" }, access: { ebayDelist: true } });
    if (reason === "scope") h.connection.scopes = [];
    expect((await h.run()).failed).toBe(1); expect(h.deps.accessToken).not.toHaveBeenCalled();
  });
  it("only reconciles listings belonging to the connected account", async () => {
    const h = harness(); h.page.orders = [order("other")]; h.db.marketplaceListing.findFirst.mockResolvedValue(null as never);
    await h.run(); expect(h.deps.reconcile).not.toHaveBeenCalled();
    expect(h.db.marketplaceListing.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ inventoryItem: { accountId: "account" }, environment: "production" }) }));
  });
  it("retains cursor when another reconciliation has not completed", async () => {
    const h = harness(); const original = structuredClone(h.job.payload); h.page.orders = [order("owned")];
    h.deps.reconcile.mockResolvedValue({ outcome: "duplicate", priorOutcome: null });
    expect((await h.run()).failed).toBe(1); expect(h.job.payload).toEqual(original);
  });
  it("replays boundary timestamps and overlaps the completed scan", () => {
    expect(advanceOrderWindow({ since: "2026-09-01T00:00:00.000Z", until: null, pendingEnds: [] }, "2026-09-02T00:00:00.000Z", false).since).toBe("2026-09-01T23:58:00.000Z");
  });
});
