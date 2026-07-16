import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  createBulkPhotoUploadGrants: vi.fn(),
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  resolveRuntimeEntitlements: vi.fn(),
}));

vi.mock("@/lib/auth/feature-access", () => ({
  resolveRuntimeEntitlements: mocks.resolveRuntimeEntitlements,
}));
vi.mock("@/lib/bulk-intake/service", () => ({
  createBulkPhotoUploadGrants: mocks.createBulkPhotoUploadGrants,
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));

import { POST } from "./route";

const batchId = "10000000-0000-4000-8000-000000000001";
const uploadId = "30000000-0000-4000-8000-000000000010";

function request() {
  return new Request(`http://localhost/api/bulk/batches/${batchId}/photos/uploads`, {
    method: "POST",
    body: JSON.stringify({
      photos: [
        {
          uploadId,
          originalName: "front.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 1234,
        },
      ],
    }),
  });
}

describe("bulk photo signed upload route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({});
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    mocks.resolveRuntimeEntitlements.mockResolvedValue({
      account: { id: "account-1", ownerUserId: "user-1", plan: "free" },
      plan: "pro",
    });
    mocks.createBulkPhotoUploadGrants.mockResolvedValue([
      { uploadId, bucket: "private", path: "scoped.jpg", token: "signed-token" },
    ]);
  });

  it("authenticates and signs only through the resolved account scope", async () => {
    const response = await POST(request(), { params: Promise.resolve({ batchId }) });

    expect(response.status).toBe(200);
    expect(mocks.createBulkPhotoUploadGrants).toHaveBeenCalledWith(
      expect.objectContaining({
        batchId,
        account: expect.objectContaining({ id: "account-1", plan: "pro" }),
        photos: [expect.objectContaining({ uploadId, sizeBytes: 1234 })],
      }),
      expect.anything(),
    );
  });

  it("does not issue upload tokens to an unauthenticated caller", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(new AppError("Sign in.", 401));

    const response = await POST(request(), { params: Promise.resolve({ batchId }) });

    expect(response.status).toBe(401);
    expect(mocks.createBulkPhotoUploadGrants).not.toHaveBeenCalled();
  });

  it("returns seller-safe 400 copy for malformed declarations", async () => {
    const malformed = new Request("http://localhost/api/bulk", {
      method: "POST",
      body: JSON.stringify({ photos: [{ uploadId: "not-a-uuid" }] }),
    });

    const response = await POST(malformed, { params: Promise.resolve({ batchId }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "The request was invalid. Please check the fields and try again.",
    });
  });
});
