import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  serverGetUser: vi.fn(),
  bearerGetUser: vi.fn(),
  cookieStore: { getAll: vi.fn(() => []), set: vi.fn() },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => mocks.cookieStore),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: mocks.serverGetUser },
  })),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mocks.bearerGetUser },
  })),
}));

import { AppError } from "../errors";
import { requireSupabaseUserFromRequestOrCookies } from "./server";

const noSession = { data: { user: null }, error: { message: "no session" } };

describe("requireSupabaseUserFromRequestOrCookies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    mocks.cookieStore.getAll.mockReturnValue([]);
  });

  it("resolves the user from the cookie session", async () => {
    mocks.serverGetUser.mockResolvedValue({
      data: { user: { id: "cookie-user" } },
      error: null,
    });

    const user = await requireSupabaseUserFromRequestOrCookies(
      new Request("http://localhost/api/marketplaces/ebay/callback"),
    );

    expect(user.id).toBe("cookie-user");
    expect(mocks.bearerGetUser).not.toHaveBeenCalled();
  });

  it("falls back to the bearer token when there is no cookie session", async () => {
    mocks.serverGetUser.mockResolvedValue(noSession);
    mocks.bearerGetUser.mockResolvedValue({
      data: { user: { id: "bearer-user" } },
      error: null,
    });

    const user = await requireSupabaseUserFromRequestOrCookies(
      new Request("http://localhost/api/marketplaces/ebay/readiness", {
        headers: { authorization: "Bearer abc.def" },
      }),
    );

    expect(user.id).toBe("bearer-user");
    expect(mocks.bearerGetUser).toHaveBeenCalledWith("abc.def");
  });

  it("rejects with 401 when neither cookie nor bearer auth is present", async () => {
    mocks.serverGetUser.mockResolvedValue(noSession);

    await expect(
      requireSupabaseUserFromRequestOrCookies(
        new Request("http://localhost/api/marketplaces/ebay/disconnect"),
      ),
    ).rejects.toMatchObject({ status: 401 });
    expect(mocks.bearerGetUser).not.toHaveBeenCalled();
  });

  it("rejects with 401 when the bearer token is invalid or expired", async () => {
    mocks.serverGetUser.mockResolvedValue(noSession);
    mocks.bearerGetUser.mockResolvedValue({
      data: { user: null },
      error: { message: "expired" },
    });

    await expect(
      requireSupabaseUserFromRequestOrCookies(
        new Request("http://localhost/api/marketplaces/ebay/readiness", {
          headers: { authorization: "Bearer stale" },
        }),
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("never derives identity from request body, query, or state claims", async () => {
    mocks.serverGetUser.mockResolvedValue({
      data: { user: { id: "verified-user" } },
      error: null,
    });

    const user = await requireSupabaseUserFromRequestOrCookies(
      new Request(
        "http://localhost/api/marketplaces/ebay/callback?userId=attacker",
        {
          method: "POST",
          body: JSON.stringify({ userId: "attacker" }),
        },
      ),
    );

    // Identity comes from Supabase getUser, not from anything in the request.
    expect(user.id).toBe("verified-user");
  });
});
