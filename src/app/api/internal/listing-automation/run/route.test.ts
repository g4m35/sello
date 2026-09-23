import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ poll: vi.fn(), queue: vi.fn(), sync: vi.fn(), stockx: vi.fn(), bulk: vi.fn(), etsy: vi.fn(), db: vi.fn(() => ({})) }));
vi.mock("@/lib/automation/listing-job", () => ({ runListingQueue: m.queue }));
vi.mock("@/lib/inventory/ebay-order-poller", () => ({ pollEbayOrders: m.poll }));
vi.mock("@/lib/inventory/stockx-status-monitor", () => ({ enqueueStockXStatusChecks: m.stockx }));
vi.mock("@/lib/inventory/etsy-status-monitor", () => ({ enqueueEtsyStatusChecks: m.etsy }));
vi.mock("@/lib/bulk-intake/jobs", () => ({ runBulkGenerationQueue: m.bulk }));
vi.mock("@/lib/prisma", () => ({ getPrisma: m.db }));
vi.mock("@/app/api/inventory/sync-jobs/run/route", () => ({ run: m.sync }));
import { GET, POST } from "./route";
describe("scheduled automation authentication", () => {
  beforeEach(() => { vi.resetAllMocks(); m.stockx.mockResolvedValue({ scheduled: 1 }); m.etsy.mockResolvedValue({ scheduled: 1 }); m.bulk.mockResolvedValue(1); vi.stubEnv("CRON_SECRET", "cron-test"); vi.stubEnv("INVENTORY_SYNC_WORKER_SECRET", "worker-test"); m.poll.mockResolvedValue({ checked: 1, failed: 0, deferred: 0 }); m.queue.mockResolvedValue(1); m.sync.mockImplementation(async () => Response.json({ ok: true })); });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
  it.each([GET, POST])("rejects missing credentials before any work", async (handler) => {
    expect((await handler(new Request("https://example.test"))).status).toBe(401); expect(m.db).not.toHaveBeenCalled();
  });
  it("fails closed when cron is not configured", async () => { vi.stubEnv("CRON_SECRET", ""); expect((await GET(new Request("https://example.test"))).status).toBe(503); expect(m.db).not.toHaveBeenCalled(); });
  it("runs sale reconciliation, guarded delisting, and listing recovery in that order", async () => {
    const response = await GET(new Request("https://example.test", { headers: { authorization: "Bearer cron-test" } }));
    expect(response.status).toBe(200); expect(m.sync.mock.invocationCallOrder[0]).toBeLessThan(m.poll.mock.invocationCallOrder[0]); expect(m.poll.mock.invocationCallOrder[0]).toBeLessThan(m.stockx.mock.invocationCallOrder[0]); expect(m.stockx.mock.invocationCallOrder[0]).toBeLessThan(m.sync.mock.invocationCallOrder[1]); expect(m.sync.mock.invocationCallOrder[1]).toBeLessThan(m.bulk.mock.invocationCallOrder[0]); expect(m.bulk.mock.invocationCallOrder[0]).toBeLessThan(m.queue.mock.invocationCallOrder[0]);
  });
  it("exposes monitor failure to the scheduler while still draining safety jobs", async () => {
    m.poll.mockResolvedValue({ checked: 0, failed: 1, deferred: 0 });
    expect((await POST(new Request("https://example.test", { headers: { "x-inventory-sync-worker-secret": "worker-test" } }))).status).toBe(503);
    expect(m.sync).toHaveBeenCalledTimes(2);
  });
  it("isolates thrown polling failures from later safety and preparation work", async () => {
    m.poll.mockRejectedValue(new Error("private provider payload"));
    const response = await GET(new Request("https://example.test", { headers: { authorization: "Bearer cron-test" } }));
    expect(response.status).toBe(503);
    const result = await response.json();
    expect(result.failedStages).toEqual(["ebay_sales"]);
    expect(JSON.stringify(result)).not.toContain("private provider payload");
    expect(m.sync).toHaveBeenCalledTimes(2);
    expect(m.bulk).toHaveBeenCalledOnce();
    expect(m.queue).toHaveBeenCalledOnce();
  });
  it.each(["failed", "failedStale", "needsReview", "retryWait"])("reports a 200 worker response with %s as a scheduler failure", async (field) => {
    m.sync.mockResolvedValueOnce(Response.json({ [field]: 1 }));
    const response = await GET(new Request("https://example.test", { headers: { authorization: "Bearer cron-test" } }));
    expect(response.status).toBe(503);
    expect((await response.json()).failedStages).toEqual(["inventory_sync"]);
    expect(m.queue).toHaveBeenCalledOnce();
  });
  it("surfaces Etsy scheduling failure without starving inventory protection", async () => {
    m.etsy.mockRejectedValue(new Error("private database detail"));
    const response = await GET(new Request("https://example.test", { headers: { authorization: "Bearer cron-test" } }));
    expect(response.status).toBe(503);
    const result = await response.json(); expect(result.failedStages).toEqual(["etsy_schedule"]);
    expect(JSON.stringify(result)).not.toContain("private database detail"); expect(m.sync).toHaveBeenCalledTimes(2); expect(m.queue).toHaveBeenCalledOnce();
  });
  it("does not begin stages whose deadline has passed", async () => {
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    m.poll.mockImplementation(async () => { now += 260000; return { failed: 0 }; });
    const response = await GET(new Request("https://example.test", { headers: { authorization: "Bearer cron-test" } }));
    expect((await response.json()).deferredStages).toEqual(["stockx_schedule", "etsy_schedule", "inventory_sync", "bulk_preparation", "listing_preparation"]);
    expect(m.sync).toHaveBeenCalledTimes(1);
    expect(m.bulk).not.toHaveBeenCalled();
    expect(m.queue).not.toHaveBeenCalled();
  });
});
