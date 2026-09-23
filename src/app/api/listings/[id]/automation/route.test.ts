import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
const m = vi.hoisted(() => ({ user: vi.fn(), account: vi.fn(), job: vi.fn(), retry: vi.fn(), recovery: vi.fn(), after: vi.fn(), run: vi.fn() }));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: m.after }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: m.user }));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: m.account }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ jobLog: { findFirst: m.job } }) }));
vi.mock("@/lib/automation/listing-job", () => ({ LISTING_QUEUE: "listing-automation-v1", runListingJob: m.run }));
vi.mock("@/lib/automation/recovery", () => ({ retryListingPreparation: m.retry, preparationRecoveryAction: m.recovery, PREPARATION_RETRY_MESSAGE: "Checking the listing and pricing again. Nothing will be published." }));
import { GET, POST } from "./route";
const request = () => GET(new Request("http://localhost"), { params: Promise.resolve({ id: "item" }) });
describe("listing progress ownership", () => {
  beforeEach(() => { vi.resetAllMocks(); m.user.mockResolvedValue({ id: "user" }); m.account.mockResolvedValue({ id: "account" }); m.recovery.mockReturnValue(null); });
  it("requires identity before reading jobs", async () => { m.user.mockRejectedValue(new AppError("Sign in.", 401)); expect((await request()).status).toBe(401); expect(m.job).not.toHaveBeenCalled(); });
  it("scopes through the inventory account and exposes only progress", async () => {
    m.job.mockResolvedValue({ status: "SUCCEEDED", result: { message: "Prepared", privateField: "hidden" }, updatedAt: new Date(0) });
    const response = await request(); expect(m.job).toHaveBeenCalledWith(expect.objectContaining({ where: { inventoryItemId: "item", inventoryItem: { accountId: "account" }, queueName: "listing-automation-v1" } }));
    expect(await response.json()).toEqual({ job: { status: "SUCCEEDED", message: "Prepared", updatedAt: "1970-01-01T00:00:00.000Z", recoveryAction: null } });
  });
  const retry = (body: unknown = { action: "retry_preparation" }) => POST(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ id: "item" }) });
  it("rejects anonymous retries before queue access", async () => {
    m.user.mockRejectedValue(new AppError("Sign in.", 401));
    expect((await retry()).status).toBe(401); expect(m.retry).not.toHaveBeenCalled();
  });
  it("does not accept automatic publication or supplied account/consent fields", async () => {
    expect((await retry({ action: "retry_preparation", consent: true, accountId: "other" })).status).toBe(400);
    expect((await retry({ action: "publish" })).status).toBe(400);
    expect(m.retry).not.toHaveBeenCalled(); expect(m.after).not.toHaveBeenCalled();
  });
  it("resolves membership before queuing a preparation-only retry", async () => {
    m.retry.mockResolvedValue("new-job");
    const response = await retry(); expect(response.status).toBe(202);
    expect(m.retry).toHaveBeenCalledWith({ inventoryItemId: "item", accountId: "account", userId: "user" }, expect.anything());
    expect(await response.json()).toMatchObject({ job: { status: "QUEUED", recoveryAction: null } });
    expect(m.run).not.toHaveBeenCalled();
    await m.after.mock.calls[0][0](); expect(m.run).toHaveBeenCalledWith("new-job");
  });
  it("does not queue work after revoked membership or recovery rejection", async () => {
    m.account.mockRejectedValueOnce(new AppError("Access denied.", 403));
    expect((await retry()).status).toBe(403); expect(m.retry).not.toHaveBeenCalled();
    m.retry.mockRejectedValue(new AppError("Reconcile first.", 409));
    expect((await retry()).status).toBe(409); expect(m.after).not.toHaveBeenCalled();
  });
});
