import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ poll: vi.fn(), queue: vi.fn(), sync: vi.fn(), db: vi.fn(() => ({})) }));
vi.mock("@/lib/automation/listing-job", () => ({ runListingQueue: m.queue }));
vi.mock("@/lib/inventory/ebay-order-poller", () => ({ pollEbayOrders: m.poll }));
vi.mock("@/lib/prisma", () => ({ getPrisma: m.db }));
vi.mock("@/app/api/inventory/sync-jobs/run/route", () => ({ run: m.sync }));
import { GET, POST } from "./route";
describe("scheduled automation authentication", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", "cron-test"); vi.stubEnv("INVENTORY_SYNC_WORKER_SECRET", "worker-test"); m.poll.mockResolvedValue({ checked: 1, failed: 0, deferred: 0 }); m.queue.mockResolvedValue(1); m.sync.mockImplementation(async () => Response.json({ ok: true })); });
  afterEach(() => vi.unstubAllEnvs());
  it.each([GET, POST])("rejects missing credentials before any work", async (handler) => {
    expect((await handler(new Request("https://example.test"))).status).toBe(401); expect(m.db).not.toHaveBeenCalled();
  });
  it("fails closed when cron is not configured", async () => { vi.stubEnv("CRON_SECRET", ""); expect((await GET(new Request("https://example.test"))).status).toBe(503); expect(m.db).not.toHaveBeenCalled(); });
  it("runs sale reconciliation, guarded delisting, and listing recovery in that order", async () => {
    const response = await GET(new Request("https://example.test", { headers: { authorization: "Bearer cron-test" } }));
    expect(response.status).toBe(200); expect(m.poll.mock.invocationCallOrder[0]).toBeLessThan(m.sync.mock.invocationCallOrder[0]); expect(m.sync.mock.invocationCallOrder[0]).toBeLessThan(m.queue.mock.invocationCallOrder[0]);
  });
  it("exposes monitor failure to the scheduler while still draining safety jobs", async () => {
    m.poll.mockResolvedValue({ checked: 0, failed: 1, deferred: 0 });
    expect((await POST(new Request("https://example.test", { headers: { "x-inventory-sync-worker-secret": "worker-test" } }))).status).toBe(503);
    expect(m.sync).toHaveBeenCalledOnce();
  });
});
