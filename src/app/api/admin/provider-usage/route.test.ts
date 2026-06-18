import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));

import { AppError } from "@/lib/errors";

import { GET } from "./route";

const req = () => new Request("http://localhost/api/admin/provider-usage");

function ledgerPrisma() {
  return {
    providerCallLedger: {
      findMany: vi.fn().mockResolvedValue([
        { id: "l1", userId: "user-2", provider: "apify-ebay-sold", status: "succeeded", estimatedCostCents: 35 },
      ]),
      aggregate: vi.fn().mockResolvedValue({ _sum: { estimatedCostCents: 70 } }),
      count: vi.fn().mockResolvedValue(2),
    },
  };
}

describe("GET /api/admin/provider-usage", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(new AppError("Sign in", 401));
    expect((await GET(req())).status).toBe(401);
  });

  it("returns 404 for a non-admin", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "a@b.com" });
    expect((await GET(req())).status).toBe(404);
  });

  it("returns cross-user aggregate totals for an admin (no token-like fields)", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@sello.com");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "owner@sello.com" });
    mocks.getPrisma.mockReturnValue(ledgerPrisma());

    const res = await GET(req());
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.totals.todaySpendCents).toBe(70);
    expect(payload.rows).toHaveLength(1);
    const serialized = JSON.stringify(payload).toLowerCase();
    expect(serialized).not.toContain("token");
    expect(serialized).not.toContain("secret");
  });

  it("returns a generic sanitized 500 for unexpected ledger failures", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "owner@example.com" });
    const prisma = ledgerPrisma();
    prisma.providerCallLedger.findMany.mockRejectedValue(
      new Error("Prisma connection contains secret-provider-token"),
    );
    mocks.getPrisma.mockReturnValue(prisma);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req());
    const body = await res.text();

    expect(res.status).toBe(500);
    expect(body).toContain("admin_provider_usage_fetch_failed");
    expect(body).not.toContain("Prisma");
    expect(body).not.toContain("secret-provider-token");
    expect(consoleError).toHaveBeenCalledWith("admin_provider_usage_fetch_failed");
    consoleError.mockRestore();
  });
});
