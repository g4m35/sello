import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  requireSupabaseUserFromRequestOrCookies: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUserFromRequestOrCookies:
    mocks.requireSupabaseUserFromRequestOrCookies,
}));
vi.mock("@/lib/billing/account", () => ({
  getActiveAccount: vi.fn().mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" }),
}));
vi.mock("@/lib/billing/connections", () => ({
  assertCanManageMarketplaceConnections: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({ marketplaceConnection: { deleteMany: mocks.deleteMany } }),
}));

import { POST } from "./route";

describe("StockX disconnect route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("deletes only the active account's StockX connection", async () => {
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({ id: "user-1" });
    const response = await POST(
      new Request("http://localhost/api/marketplaces/stockx/disconnect", { method: "POST" }),
    );
    expect(response.status).toBe(200);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { accountId: "acc-1", marketplace: "stockx", environment: "production" },
    });
  });

  it("requires authentication", async () => {
    mocks.requireSupabaseUserFromRequestOrCookies.mockRejectedValue(
      new AppError("Sign in.", 401),
    );
    const response = await POST(
      new Request("http://localhost/api/marketplaces/stockx/disconnect", { method: "POST" }),
    );
    expect(response.status).toBe(401);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});
