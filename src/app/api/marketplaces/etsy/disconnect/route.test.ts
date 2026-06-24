import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  requireSupabaseUserFromRequestOrCookies: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUserFromRequestOrCookies:
    mocks.requireSupabaseUserFromRequestOrCookies,
}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({ marketplaceConnection: { deleteMany: mocks.deleteMany } }),
}));

import { POST } from "./route";

describe("Etsy disconnect route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteMany.mockResolvedValue({ count: 1 });
  });

  it("deletes only the signed-in seller's Etsy connection", async () => {
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({ id: "u1" });
    const response = await POST(
      new Request("http://localhost/api/marketplaces/etsy/disconnect", { method: "POST" }),
    );
    expect(response.status).toBe(200);
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", marketplace: "etsy", environment: "production" },
    });
  });

  it("requires authentication", async () => {
    mocks.requireSupabaseUserFromRequestOrCookies.mockRejectedValue(
      new AppError("Sign in.", 401),
    );
    const response = await POST(
      new Request("http://localhost/api/marketplaces/etsy/disconnect", { method: "POST" }),
    );
    expect(response.status).toBe(401);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});
