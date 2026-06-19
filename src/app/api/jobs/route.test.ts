import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));

import { GET } from "./route";

function prisma() {
  return { jobLog: { findMany: vi.fn().mockResolvedValue([]) } };
}

function ebayPublish(payload: {
  adapters: { marketplace: string; capabilities: { publish: boolean } }[];
}): boolean | undefined {
  return payload.adapters.find((a) => a.marketplace === "ebay")?.capabilities.publish;
}

describe("jobs API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
