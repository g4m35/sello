import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  executeEbayDelist: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));

vi.mock("@/lib/marketplace/delist-handler", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/marketplace/delist-handler")
  >();
  return { ...actual, executeEbayDelist: mocks.executeEbayDelist };
});

import { POST } from "./route";

describe("delist API auth boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EBAY_DELIST_EMAILS", "allowed@example.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects authenticated sellers outside the delist alpha before side effects", async () => {
    const prismaWrite = vi.fn();
    const outboundAdapter = vi.fn();
    mocks.requireSupabaseUser.mockResolvedValue({
      id: "user-1",
      email: "not-allowed@example.com",
    });
    mocks.getPrisma.mockReturnValue({});
    mocks.executeEbayDelist.mockImplementationOnce(async () => {
      prismaWrite();
      outboundAdapter();
      throw new Error("delist should not execute");
    });

    const response = await POST(
      new Request("http://localhost/api/listings/delist", {
        method: "POST",
        body: JSON.stringify({
          inventoryItemId: "11111111-1111-4111-8111-111111111111",
          confirmLiveDelist: true,
        }),
      }),
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toEqual({
      error: {
        code: "EBAY_DELIST_ALPHA_ONLY",
        message:
          "Live eBay delisting is currently enabled for selected alpha accounts.",
      },
    });
    expect(mocks.executeEbayDelist).not.toHaveBeenCalled();
    expect(mocks.getPrisma).not.toHaveBeenCalled();
    expect(prismaWrite).not.toHaveBeenCalled();
    expect(outboundAdapter).not.toHaveBeenCalled();
  });
});
