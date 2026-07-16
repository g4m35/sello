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

describe("GET /api/inventory/review-tasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: "member-1" });
    mocks.getActiveAccount.mockResolvedValue({ id: "account-1" });
    mocks.getPrisma.mockReturnValue({ reviewTask: { findMany: mocks.findMany } });
    mocks.findMany.mockResolvedValue([{ id: "task-1", title: "Review sale" }]);
  });

  it("requires authentication", async () => {
    mocks.requireUser.mockRejectedValue(new AppError("Sign in.", 401));
    const response = await GET(new Request("http://localhost/api/inventory/review-tasks"));
    expect(response.status).toBe(401);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("lists only the active account's open tasks by default", async () => {
    const response = await GET(new Request("http://localhost/api/inventory/review-tasks"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      reviewTasks: [{ id: "task-1", title: "Review sale" }],
    });
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { accountId: "account-1", status: "open" } }),
    );
  });

  it("supports a closed status without weakening account scope", async () => {
    await GET(
      new Request("http://localhost/api/inventory/review-tasks?status=resolved"),
    );
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({
      accountId: "account-1",
      status: "resolved",
    });
  });
});
