import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));

import { GET } from "./route";

function prisma() {
  return { jobLog: { findMany: vi.fn().mockResolvedValue([]) } };
}

function ebayPublish(payload: {
  adapters: { marketplace: string; capabilities: { publish: boolean } }[];
}): boolean | undefined {
  return payload.adapters.find((a) => a.marketplace === "ebay")?.capabilities.publish;
}

function stockx(payload: {
  adapters: {
    marketplace: string;
    capabilities: { publish: boolean; inventorySync: boolean; delist?: boolean };
  }[];
}) {
  return payload.adapters.find((a) => a.marketplace === "stockx");
}

function stubStockXEnv() {
  vi.stubEnv("STOCKX_API_ENABLED", "true");
  vi.stubEnv("STOCKX_LISTING_ENABLED", "true");
  vi.stubEnv("STOCKX_CLIENT_ID", "client-id");
  vi.stubEnv("STOCKX_CLIENT_SECRET", "client-secret");
  vi.stubEnv("STOCKX_REDIRECT_URI", "https://sello.wtf/api/marketplaces/stockx/callback");
  vi.stubEnv("STOCKX_TOKEN_ENCRYPTION_KEY", "x".repeat(32));
  vi.stubEnv("STOCKX_OAUTH_STATE_SECRET", "s".repeat(32));
  vi.stubEnv("STOCKX_API_KEY", "api-key");
}

describe("jobs API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "u1", plan: "free" });
    mocks.getPrisma.mockReturnValue(prisma());
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects job visibility when the seller is not signed in", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(
      new AppError("Sign in before creating a listing draft.", 401),
    );
    const response = await GET(new Request("http://localhost/api/jobs", { method: "GET" }));
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toEqual({ error: "Sign in before creating a listing draft." });
  });

  it("reports eBay live publishing when the global gate is on and the seller is entitled", async () => {
    vi.stubEnv("EBAY_PRODUCTION_PUBLISH_ENABLED", "true");
    vi.stubEnv("LIVE_EBAY_PUBLISH_EMAILS", "owner@example.com");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "owner@example.com" });

    const payload = await (await GET(new Request("http://localhost/api/jobs"))).json();

    expect(payload.publishingImplemented).toBe(true);
    expect(payload.ebayLivePublishEnabled).toBe(true);
    expect(ebayPublish(payload)).toBe(true);
    expect(payload.inventorySyncAvailable).toBe(false);
  });

  it("reports StockX live listing and delist readiness from the StockX API config", async () => {
    stubStockXEnv();
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "owner@example.com" });

    const payload = await (await GET(new Request("http://localhost/api/jobs"))).json();
    const stockxAdapter = stockx(payload);

    expect(payload.publishingImplemented).toBe(true);
    expect(payload.stockxListingEnabled).toBe(true);
    expect(payload.stockxDelistEnabled).toBe(true);
    expect(payload.inventorySyncAvailable).toBe(true);
    expect(stockxAdapter?.capabilities.publish).toBe(true);
    expect(stockxAdapter?.capabilities.inventorySync).toBe(true);
    expect(stockxAdapter?.capabilities.delist).toBe(true);
  });

  it("scopes job logs to the active account", async () => {
    const db = prisma();
    mocks.getPrisma.mockReturnValue(db);
    mocks.requireSupabaseUser.mockResolvedValue({ id: "member-1", email: "member@example.com" });

    const response = await GET(new Request("http://localhost/api/jobs"));

    expect(response.status).toBe(200);
    expect(db.jobLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { inventoryItem: { accountId: "acc-1" } },
      }),
    );
  });

  it("keeps eBay publishing unimplemented for sellers outside the allowlist", async () => {
    vi.stubEnv("EBAY_PRODUCTION_PUBLISH_ENABLED", "true");
    vi.stubEnv("LIVE_EBAY_PUBLISH_EMAILS", "someone-else@example.com");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "owner@example.com" });

    const payload = await (await GET(new Request("http://localhost/api/jobs"))).json();

    expect(payload.publishingImplemented).toBe(false);
    expect(ebayPublish(payload)).toBe(false);
  });

  it("keeps eBay publishing unimplemented when the global gate is off even for an entitled seller", async () => {
    vi.stubEnv("LIVE_EBAY_PUBLISH_EMAILS", "owner@example.com");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "owner@example.com" });

    const payload = await (await GET(new Request("http://localhost/api/jobs"))).json();

    expect(payload.publishingImplemented).toBe(false);
    expect(ebayPublish(payload)).toBe(false);
  });
});
