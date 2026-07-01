import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createStockXOAuthStateCookie,
  stockxOAuthStateCookieName,
} from "@/lib/marketplace/adapters/stockx/oauth";

const mocks = vi.hoisted(() => ({
  requireSupabaseUserFromRequestOrCookies: vi.fn(),
  upsert: vi.fn(),
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
  getPrisma: () => ({ marketplaceConnection: { upsert: mocks.upsert } }),
}));

import { GET } from "./route";

const SECRET = "x".repeat(40);
const ENV_KEYS = [
  "STOCKX_API_ENABLED",
  "STOCKX_CLIENT_ID",
  "STOCKX_CLIENT_SECRET",
  "STOCKX_REDIRECT_URI",
  "STOCKX_TOKEN_ENCRYPTION_KEY",
  "STOCKX_OAUTH_STATE_SECRET",
];

function requestWith(args: { state: string; code: string; cookieState: string }) {
  const cookie = createStockXOAuthStateCookie({
    userId: "user-1",
    state: args.cookieState,
    secret: SECRET,
  });
  return new Request(
    `http://localhost/api/marketplaces/stockx/callback?code=${args.code}&state=${args.state}`,
    { headers: { cookie: `${stockxOAuthStateCookieName}=${cookie.value}` } },
  );
}

describe("StockX callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STOCKX_API_ENABLED = "true";
    process.env.STOCKX_CLIENT_ID = "stockx-client-id";
    process.env.STOCKX_CLIENT_SECRET = "stockx-client-secret";
    process.env.STOCKX_REDIRECT_URI = "https://sello.wtf/api/marketplaces/stockx/callback";
    process.env.STOCKX_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
    process.env.STOCKX_OAUTH_STATE_SECRET = SECRET;
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({ id: "user-1" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: "access-token",
              refresh_token: "refresh-token",
              expires_in: 3600,
              scope: "offline_access openid",
            }),
            { status: 200 },
          ),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("stores encrypted StockX tokens under the active account", async () => {
    const response = await GET(
      requestWith({ state: "state-1", code: "auth", cookieState: "state-1" }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/settings/marketplaces");
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const args = mocks.upsert.mock.calls[0][0];
    expect(args.where.accountId_marketplace_environment).toEqual({
      accountId: "acc-1",
      marketplace: "stockx",
      environment: "production",
    });
    expect(args.create.accountId).toBe("acc-1");
    expect(args.create.marketplace).toBe("stockx");
    expect(args.create.accessTokenEnc.startsWith("v1.")).toBe(true);
    expect(args.create.accessTokenEnc).not.toContain("access-token");
    expect(args.create.refreshTokenEnc).not.toContain("refresh-token");
  });

  it("rejects state mismatch without writing tokens", async () => {
    const response = await GET(
      requestWith({ state: "state-1", code: "auth", cookieState: "other" }),
    );
    expect(response.status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects callbacks for a different signed-in user", async () => {
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({ id: "other-user" });
    const response = await GET(
      requestWith({ state: "state-1", code: "auth", cookieState: "state-1" }),
    );
    expect(response.status).toBe(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
