import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/lib/errors";
const m = vi.hoisted(() => ({ user: vi.fn(), account: vi.fn(), job: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: m.user }));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: m.account }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({ jobLog: { findFirst: m.job } }) }));
vi.mock("@/lib/automation/listing-job", () => ({ LISTING_QUEUE: "listing-automation-v1" }));
import { GET } from "./route";
const request = () => GET(new Request("http://localhost"), { params: Promise.resolve({ id: "item" }) });
describe("listing progress ownership", () => {
  beforeEach(() => { vi.clearAllMocks(); m.user.mockResolvedValue({ id: "user" }); m.account.mockResolvedValue({ id: "account" }); });
  it("requires identity before reading jobs", async () => { m.user.mockRejectedValue(new AppError("Sign in.", 401)); expect((await request()).status).toBe(401); expect(m.job).not.toHaveBeenCalled(); });
  it("scopes through the inventory account and exposes only progress", async () => {
    m.job.mockResolvedValue({ status: "SUCCEEDED", result: { message: "Prepared", privateField: "hidden" }, updatedAt: new Date(0) });
    const response = await request(); expect(m.job).toHaveBeenCalledWith(expect.objectContaining({ where: { inventoryItemId: "item", inventoryItem: { accountId: "account" }, queueName: "listing-automation-v1" } }));
    expect(await response.json()).toEqual({ job: { status: "SUCCEEDED", message: "Prepared", updatedAt: "1970-01-01T00:00:00.000Z" } });
  });
});
