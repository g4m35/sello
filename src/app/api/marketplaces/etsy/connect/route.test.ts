import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { etsyOAuthStateCookieName } from "@/lib/marketplace/adapters/etsy/oauth";

const mocks = vi.hoisted(() => ({
  requireSupabaseUserFromRequestOrCookies: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUserFromRequestOrCookies:
    mocks.requireSupabaseUserFromRequestOrCookies,
}));
vi.mock("@/lib/billing/account", () => ({
  getActiveAccount: vi
    .fn()
    .mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "free" }),
}));
vi.mock("@/lib/billing/connections", () => ({
  assertCanConnectMarketplace: vi.fn().mockResolvedValue(undefined),
}));

import { GET } from "./route";

const ETSY_KEYS = [
  "ETSY_API_ENABLED",
  "ETSY_CONNECT_EMAILS",
  "ETSY_CLIENT_ID",
  "ETSY_REDIRECT_URI",
  "ETSY_TOKEN_ENCRYPTION_KEY",
  "ETSY_OAUTH_STATE_SECRET",
];

describe("Etsy connect route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ETSY_API_ENABLED = "true";
    process.env.ETSY_CONNECT_EMAILS = "seller@example.com";
    process.env.ETSY_CLIENT_ID = "etsy-keystring";
    process.env.ETSY_REDIRECT_URI = "https://sello.wtf/api/marketplaces/etsy/callback";
    process.env.ETSY_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
    process.env.ETSY_OAUTH_STATE_SECRET = "x".repeat(40);
  });
  afterEach(() => {
    for (const key of ETSY_KEYS) delete process.env[key];
  });

  it("requires an authenticated seller", async () => {
    mocks.requireSupabaseUserFromRequestOrCookies.mockRejectedValue(
      new AppError("Sign in.", 401),
    );
    const response = await GET(new Request("http://localhost/api/marketplaces/etsy/connect"));
    expect(response.status).toBe(401);
  });

  it("fails closed when the API switch is off", async () => {
    process.env.ETSY_API_ENABLED = "false";
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({
      id: "u1",
      email: "seller@example.com",
    });
    const response = await GET(
      new Request("http://localhost/api/marketplaces/etsy/connect", {
        headers: { accept: "application/json" },
      }),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("ETSY_NOT_ENABLED");
  });

  it("fails closed when the seller is not on the connect allowlist", async () => {
    process.env.ETSY_CONNECT_EMAILS = "someone-else@example.com";
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({
      id: "u1",
      email: "seller@example.com",
    });
    const response = await GET(
      new Request("http://localhost/api/marketplaces/etsy/connect", {
        headers: { accept: "application/json" },
      }),
    );
    expect(response.status).toBe(403);
  });

  it("returns a PKCE authorization URL and an httpOnly state cookie", async () => {
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({
      id: "u1",
      email: "seller@example.com",
    });
    const response = await GET(
      new Request("http://localhost/api/marketplaces/etsy/connect", {
        headers: { accept: "application/json" },
      }),
    );
    const payload = await response.json();
    expect(response.status).toBe(200);
    expect(payload.authorizationUrl).toContain("www.etsy.com/oauth/connect");
    expect(payload.authorizationUrl).toContain("code_challenge_method=S256");
    expect(payload.authorizationUrl).toContain("scope=");
    expect(payload.authorizationUrl).not.toContain("ETSY_TOKEN_ENCRYPTION_KEY");
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(etsyOAuthStateCookieName);
    expect(cookie).toContain("HttpOnly");
  });
});
