import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  executeBulkEbayPublish: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));
vi.mock("@/lib/marketplace/bulk-publish", () => ({
  executeBulkEbayPublish: mocks.executeBulkEbayPublish,
}));

import { POST } from "./route";

function u(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
}
function req(body: unknown): Request {
  return new Request("http://localhost/api/listings/publish/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("bulk publish execution route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("LIVE_EBAY_PUBLISH_EMAILS", "allowed@example.com");
    mocks.getPrisma.mockReturnValue({});
    mocks.executeBulkEbayPublish.mockResolvedValue({
      bulkRunId: u(999),
      total: 1,
      publishedCount: 1,
      skippedCount: 0,
      failedCount: 0,
      needsDetailsCount: 0,
      items: [],
    });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects anonymous callers before any side effects", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(new AppError("Sign in", 401));
    const res = await POST(req({ itemIds: [u(1)], confirmLivePublish: true }));
    expect(res.status).toBe(401);
    expect(mocks.executeBulkEbayPublish).not.toHaveBeenCalled();
  });

  it("blocks non-allowlisted sellers with 403 before any side effects", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "nope@example.com" });
    const res = await POST(req({ itemIds: [u(1)], confirmLivePublish: true }));
    const payload = await res.json();
    expect(res.status).toBe(403);
    expect(payload.error.code).toBe("LIVE_EBAY_PUBLISH_ALPHA_ONLY");
    expect(mocks.executeBulkEbayPublish).not.toHaveBeenCalled();
  });

  it("requires an explicit confirmLivePublish:true", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "allowed@example.com" });
    const res = await POST(req({ itemIds: [u(1)] }));
    expect(res.status).toBe(400);
    expect(mocks.executeBulkEbayPublish).not.toHaveBeenCalled();
  });

  it("executes for allowlisted sellers and forwards the provided bulkRunId", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "allowed@example.com" });
    const res = await POST(
      req({ itemIds: [u(1), u(2)], confirmLivePublish: true, bulkRunId: u(999) }),
    );
    expect(res.status).toBe(200);
    expect(mocks.executeBulkEbayPublish).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ userId: "user-1", itemIds: [u(1), u(2)], bulkRunId: u(999) }),
    );
  });

  it("generates a single bulkRunId when none is provided", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "allowed@example.com" });
    await POST(req({ itemIds: [u(1)], confirmLivePublish: true }));
    const call = mocks.executeBulkEbayPublish.mock.calls[0][1];
    expect(call.bulkRunId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects selections over the transport ceiling before any side effects", async () => {
    vi.stubEnv("BULK_PUBLISH_MAX_ITEMS", "2");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "allowed@example.com" });
    const res = await POST(
      req({ itemIds: [u(1), u(2), u(3)], confirmLivePublish: true }),
    );
    expect(res.status).toBe(400);
    expect(mocks.executeBulkEbayPublish).not.toHaveBeenCalled();
  });
});
