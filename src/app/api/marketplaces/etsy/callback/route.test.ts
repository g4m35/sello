import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createEtsyOAuthStateCookie,
  etsyOAuthStateCookieName,
} from "@/lib/marketplace/adapters/etsy/oauth";

const mocks = vi.hoisted(() => ({
  requireSupabaseUserFromRequestOrCookies: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUserFromRequestOrCookies:
    mocks.requireSupabaseUserFromRequestOrCookies,
}));
vi.mock("@/lib/prisma", () => ({
  getPrisma: () => ({ marketplaceConnection: { upsert: mocks.upsert } }),
}));

import { GET } from "./route";

const SECRET = "x".repeat(40);

function requestWith(args: { state: string; code: string; cookieState: string }) {
  const cookie = createEtsyOAuthStateCookie({
    userId: "u1",
    state: args.cookieState,
    codeVerifier: "verifier-1",
    secret: SECRET,
  });
  return new Request(
    `http://localhost/api/marketplaces/etsy/callback?code=${args.code}&state=${args.state}`,
    { headers: { cookie: `${etsyOAuthStateCookieName}=${cookie.value}` } },
  );
}

describe("Etsy callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ETSY_API_ENABLED = "true";
    process.env.ETSY_CLIENT_ID = "etsy-keystring";
    process.env.ETSY_REDIRECT_URI = "https://sello.wtf/cb";
    process.env.ETSY_TOKEN_ENCRYPTION_KEY = "a".repeat(64);
    process.env.ETSY_OAUTH_STATE_SECRET = SECRET;
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({ id: "u1" });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              access_token: "12345.access-token",
              refresh_token: "refresh-token",
              expires_in: 3600,
            }),
            { status: 200 },
          ),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of [
      "ETSY_API_ENABLED",
      "ETSY_CLIENT_ID",
      "ETSY_REDIRECT_URI",
      "ETSY_TOKEN_ENCRYPTION_KEY",
      "ETSY_OAUTH_STATE_SECRET",
    ]) {
      delete process.env[key];
    }
  });

  it("stores encrypted tokens and redirects on a valid callback", async () => {
    const response = await GET(requestWith({ state: "s1", code: "auth", cookieState: "s1" }));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/settings/marketplaces");
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    const args = mocks.upsert.mock.calls[0][0];
    expect(args.create.marketplace).toBe("etsy");
    expect(args.create.environment).toBe("production");
    expect(args.create.externalUserId).toBe("12345");
    // Tokens are encrypted at rest, never the raw values.
    expect(args.create.accessTokenEnc).not.toContain("access-token");
    expect(args.create.refreshTokenEnc).not.toContain("refresh-token");
    expect(args.create.accessTokenEnc.startsWith("v1.")).toBe(true);
  });

  it("rejects a state mismatch without storing a token", async () => {
    const response = await GET(requestWith({ state: "s1", code: "auth", cookieState: "OTHER" }));
    expect(response.status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects when the signed-in user is not the state owner", async () => {
    mocks.requireSupabaseUserFromRequestOrCookies.mockResolvedValue({ id: "different" });
    const response = await GET(requestWith({ state: "s1", code: "auth", cookieState: "s1" }));
    expect(response.status).toBe(403);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
