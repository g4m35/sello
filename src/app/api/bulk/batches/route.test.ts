import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  createBulkBatch: vi.fn(),
  getActiveAccount: vi.fn(),
  getPrisma: vi.fn(),
  listBulkBatches: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/bulk-intake/service", () => ({
  createBulkBatch: mocks.createBulkBatch,
  listBulkBatches: mocks.listBulkBatches,
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));

import { GET, POST } from "./route";

describe("/api/bulk/batches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({});
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "seller@example.com" });
    mocks.getActiveAccount.mockResolvedValue({ id: "account-1", ownerUserId: "user-1", plan: "free" });
    mocks.listBulkBatches.mockResolvedValue([]);
    mocks.createBulkBatch.mockResolvedValue({ id: "batch-1" });
  });

  it("requires authentication for creation", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(new AppError("Sign in.", 401));
    const response = await POST(
      new Request("http://localhost/api/bulk/batches", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(response.status).toBe(401);
    expect(mocks.createBulkBatch).not.toHaveBeenCalled();
  });

  it("resolves the active account before creating the durable batch", async () => {
    const response = await POST(
      new Request("http://localhost/api/bulk/batches", {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: "request-123", expectedItems: 5 }),
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.createBulkBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        account: expect.objectContaining({ id: "account-1" }),
        user: expect.objectContaining({ id: "user-1" }),
        expectedItems: 5,
      }),
      expect.anything(),
    );
  });

  it("lists only through the active account scope", async () => {
    const response = await GET(new Request("http://localhost/api/bulk/batches"));
    expect(response.status).toBe(200);
    expect(mocks.listBulkBatches).toHaveBeenCalledWith("account-1", expect.anything());
  });
});
