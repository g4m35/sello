import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireAdminUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/auth/admin", () => ({ requireAdminUser: mocks.requireAdminUser }));

import { GET } from "./route";

describe("GET /api/admin/bulk-intake", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("requires admin access", async () => {
    mocks.requireAdminUser.mockRejectedValue(new AppError("Not found.", 404));
    expect((await GET(new Request("http://localhost/api/admin/bulk-intake"))).status).toBe(404);
  });

  it("returns aggregate batch visibility without storage or provider data", async () => {
    mocks.requireAdminUser.mockResolvedValue({ id: "admin" });
    mocks.getPrisma.mockReturnValue({
      bulkBatch: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "batch-1",
            accountId: "account-1",
            createdByUserId: "user-1",
            status: "partially_failed",
            photoCount: 6,
            totalItems: 2,
            processedItems: 2,
            needsReviewItems: 0,
            listingReadyItems: 1,
            failedItems: 1,
            canceledItems: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ]),
      },
    });

    const response = await GET(new Request("http://localhost/api/admin/bulk-intake"));
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.totals).toMatchObject({ batches: 1, failed: 1, items: 2 });
    expect(JSON.stringify(payload).toLowerCase()).not.toMatch(/token|secret|storagepath/);
  });
});
