import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  registerBulkPhotos: vi.fn(),
  requireSupabaseUser: vi.fn(),
  resolveRuntimeEntitlements: vi.fn(),
}));

vi.mock("@/lib/auth/feature-access", () => ({
  resolveRuntimeEntitlements: mocks.resolveRuntimeEntitlements,
}));
vi.mock("@/lib/bulk-intake/service", () => ({ registerBulkPhotos: mocks.registerBulkPhotos }));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));

import { POST } from "./route";

const batchId = "10000000-0000-4000-8000-000000000001";
const uploadId = "30000000-0000-4000-8000-000000000010";

describe("bulk photo metadata route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPrisma.mockReturnValue({});
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    mocks.resolveRuntimeEntitlements.mockResolvedValue({
      account: { id: "account-1", ownerUserId: "user-1", plan: "free" },
      plan: "pro",
    });
    mocks.registerBulkPhotos.mockResolvedValue({ id: batchId, photoCount: 1 });
  });

  it("registers JSON metadata after the direct storage upload", async () => {
    const photo = {
      uploadId,
      originalName: "front.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 1234,
      storagePath: `bulk/account-1/${batchId}/${uploadId}.jpg`,
    };
    const request = new Request(`http://localhost/api/bulk/batches/${batchId}/photos`, {
      method: "POST",
      body: JSON.stringify({ photos: [photo] }),
    });

    const response = await POST(request, { params: Promise.resolve({ batchId }) });

    expect(response.status).toBe(200);
    expect(mocks.registerBulkPhotos).toHaveBeenCalledWith(
      expect.objectContaining({ batchId, photos: [photo] }),
      expect.anything(),
    );
  });
});
