import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUserFromRequestOrCookies: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUserFromRequestOrCookies: mocks.requireSupabaseUserFromRequestOrCookies,
}));

import { POST } from "./route";

describe("eBay disconnect route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes only the current user's sandbox connection", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
    });
    mocks.getPrisma.mockReturnValue({
      marketplaceConnection: { deleteMany },
    });

    const response = await POST(
      new Request("http://localhost/api/marketplaces/ebay/disconnect", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "11111111-1111-4111-8111-111111111111",
        marketplace: "ebay",
        environment: "sandbox",
      },
    });
  });
});
