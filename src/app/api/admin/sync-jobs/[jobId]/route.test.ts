import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancelSyncJob: vi.fn(),
  getPrisma: vi.fn(),
  requireAdminUser: vi.fn(),
  retrySyncJobForAdmin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/admin", () => ({ requireAdminUser: mocks.requireAdminUser }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/inventory-sync/jobs/worker", () => ({
  cancelSyncJob: mocks.cancelSyncJob,
  retrySyncJobForAdmin: mocks.retrySyncJobForAdmin,
}));

import { AppError } from "@/lib/errors";

import { POST } from "./route";

const context = { params: Promise.resolve({ jobId: "job-1" }) };
const request = (action: "retry" | "cancel") =>
  new Request("http://localhost/api/admin/sync-jobs/job-1", {
    method: "POST",
    body: JSON.stringify({ action }),
  });

describe("admin sync-job control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminUser.mockResolvedValue({ id: "admin-1" });
    mocks.getPrisma.mockReturnValue({
      syncJob: { findFirst: vi.fn(), updateMany: vi.fn() },
      inventoryEvent: { create: vi.fn() },
    });
  });

  it("retries an eligible job through the worker control", async () => {
    mocks.retrySyncJobForAdmin.mockResolvedValue(true);
    const response = await POST(request("retry"), context);
    expect(response.status).toBe(200);
    expect(mocks.retrySyncJobForAdmin).toHaveBeenCalledWith(
      expect.objectContaining({
        syncJob: expect.objectContaining({
          findFirst: expect.any(Function),
          updateMany: expect.any(Function),
        }),
        inventoryEvent: expect.objectContaining({ create: expect.any(Function) }),
      }),
      "job-1",
      "admin-1",
    );
    expect(await response.json()).toEqual({ ok: true, jobId: "job-1", status: "queued" });
  });

  it("cancels only work that has not started", async () => {
    mocks.cancelSyncJob.mockResolvedValue(true);
    const response = await POST(request("cancel"), context);
    expect(response.status).toBe(200);
    expect(mocks.cancelSyncJob).toHaveBeenCalledWith(
      expect.objectContaining({
        syncJob: expect.objectContaining({
          findFirst: expect.any(Function),
          updateMany: expect.any(Function),
        }),
        inventoryEvent: expect.objectContaining({ create: expect.any(Function) }),
      }),
      "job-1",
      "admin-1",
    );
  });

  it("fails closed for non-admins before reading the job", async () => {
    mocks.requireAdminUser.mockRejectedValue(new AppError("Not found.", 404));
    const response = await POST(request("retry"), context);
    expect(response.status).toBe(404);
    expect(mocks.retrySyncJobForAdmin).not.toHaveBeenCalled();
  });

  it("returns a stable conflict when retry is exhausted", async () => {
    mocks.retrySyncJobForAdmin.mockResolvedValue(false);
    const response = await POST(request("retry"), context);
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("SYNC_JOB_RETRY_NOT_ALLOWED");
  });
});
