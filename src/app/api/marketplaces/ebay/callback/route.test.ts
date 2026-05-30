import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import {
  createEbayOAuthStateCookie,
  ebayOAuthStateCookieName,
} from "@/lib/marketplace/adapters/ebay/oauth";
import { decryptEbayToken } from "@/lib/marketplace/adapters/ebay/token-crypto";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  getPrisma: mocks.getPrisma,
}));

vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUser: mocks.requireSupabaseUser,
}));

import { GET } from "./route";

const key =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const stateSecret = "state-secret-state-secret-state-secret-0123456789";
const userId = "11111111-1111-4111-8111-111111111111";
const otherUserId = "22222222-2222-4222-8222-222222222222";

function tokenResponse() {
  return new Response(
    JSON.stringify({
      access_token: "raw-access-token",
      refresh_token: "raw-refresh-token",
      expires_in: 7200,
      refresh_token_expires_in: 86400,
      scope: "scope-a scope-b",
    }),
    { status: 200 },
  );
}

function callbackRequest(args: {
  state: string;
  cookieValue: string;
  code?: string;
}) {
  const search = new URLSearchParams({ code: args.code ?? "abc" });
  search.set("state", args.state);
  return new Request(
    `http://localhost/api/marketplaces/ebay/callback?${search.toString()}`,
    {
      headers: {
        cookie: `${ebayOAuthStateCookieName}=${args.cookieValue}`,
      },
    },
  );
}

describe("eBay callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.EBAY_ENV = "sandbox";
    process.env.EBAY_CLIENT_ID = "client-id";
    process.env.EBAY_CLIENT_SECRET = "client-secret";
    process.env.EBAY_REDIRECT_URI_NAME = "redirect-name";
    process.env.EBAY_MARKETPLACE_ID = "EBAY_US";
    process.env.EBAY_TOKEN_ENCRYPTION_KEY = key;
    process.env.EBAY_OAUTH_STATE_SECRET = stateSecret;
    mocks.requireSupabaseUser.mockResolvedValue({ id: userId });
  });

  it("rejects missing state", async () => {
    const response = await GET(
      new Request("http://localhost/api/marketplaces/ebay/callback?code=abc"),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("EBAY_OAUTH_STATE_INVALID");
  });

  it("rejects wrong state", async () => {
    const cookie = createEbayOAuthStateCookie({
      userId,
      state: "right-state",
      secret: stateSecret,
    });

    const response = await GET(
      callbackRequest({ state: "wrong-state", cookieValue: cookie.value }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("EBAY_OAUTH_STATE_INVALID");
  });

  it("rejects a state cookie signed with the token encryption key (no longer depends on it)", async () => {
    const cookie = createEbayOAuthStateCookie({
      userId,
      state: "state-1",
      secret: key,
    });

    const response = await GET(
      callbackRequest({ state: "state-1", cookieValue: cookie.value }),
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("EBAY_OAUTH_STATE_INVALID");
  });

  it("rejects when there is no session", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(
      new AppError("Sign in.", 401),
    );
    const upsert = vi.fn();
    mocks.getPrisma.mockReturnValue({ marketplaceConnection: { upsert } });
    const cookie = createEbayOAuthStateCookie({
      userId,
      state: "state-1",
      secret: stateSecret,
    });

    const response = await GET(
      callbackRequest({ state: "state-1", cookieValue: cookie.value }),
    );

    expect(response.status).toBe(401);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects when the session user differs from the state user and does not upsert", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: otherUserId });
    const upsert = vi.fn();
    mocks.getPrisma.mockReturnValue({ marketplaceConnection: { upsert } });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const cookie = createEbayOAuthStateCookie({
      userId,
      state: "state-1",
      secret: stateSecret,
    });

    const response = await GET(
      callbackRequest({ state: "state-1", cookieValue: cookie.value }),
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("EBAY_OAUTH_STATE_INVALID");
    expect(upsert).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stores encrypted tokens and redirects when the session user matches the state user", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "connection-1" });
    mocks.getPrisma.mockReturnValue({ marketplaceConnection: { upsert } });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(tokenResponse());
    const cookie = createEbayOAuthStateCookie({
      userId,
      state: "state-1",
      secret: stateSecret,
    });

    const response = await GET(
      callbackRequest({ state: "state-1", cookieValue: cookie.value }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/settings/marketplaces",
    );
    expect(JSON.stringify(upsert.mock.calls)).not.toContain("raw-access-token");
    expect(JSON.stringify(upsert.mock.calls)).not.toContain("raw-refresh-token");
    const data = upsert.mock.calls[0][0].create;
    expect(data.userId).toBe(userId);
    expect(decryptEbayToken(data.accessTokenEnc, key)).toBe("raw-access-token");
    expect(decryptEbayToken(data.refreshTokenEnc, key)).toBe("raw-refresh-token");
  });
});
