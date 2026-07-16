import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getPrisma: vi.fn(),
  getActiveAccount: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUserFromRequestOrCookies: mocks.requireUser,
}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));

import { GET } from "./route";

describe("GET /api/inventory/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: "member-1" });
    mocks.getActiveAccount.mockResolvedValue({ id: "account-1" });
    mocks.getPrisma.mockReturnValue({ notification: { findMany: mocks.findMany } });
    mocks.findMany.mockResolvedValue([{ id: "notification-1", title: "Item sold" }]);
  });

  it("requires authentication", async () => {
    mocks.requireUser.mockRejectedValue(new AppError("Sign in.", 401));
    const response = await GET(new Request("http://localhost/api/inventory/notifications"));
    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("lists notifications only for the active account", async () => {
    const response = await GET(new Request("http://localhost/api/inventory/notifications"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      notifications: [{ id: "notification-1", title: "Item sold" }],
    });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: "account-1" } }),
    );
  });
});
