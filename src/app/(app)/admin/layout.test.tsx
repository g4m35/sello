import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSupabaseUserFromCookies: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseUserFromCookies: mocks.getSupabaseUserFromCookies,
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import AdminLayout from "./layout";

async function renderAdminRoute(routeShell: string) {
  return AdminLayout({ children: routeShell });
}

describe("server-side admin route guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSupabaseUserFromCookies.mockResolvedValue(null);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("does not render the provider-usage shell for an unauthenticated user", async () => {
    await expect(renderAdminRoute("provider usage admin shell")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("does not render the provider-usage shell for a non-admin user", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    mocks.getSupabaseUserFromCookies.mockResolvedValue({
      id: "user-1",
      email: "seller@example.com",
    });

    await expect(renderAdminRoute("provider usage admin shell")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("does not render the feedback shell for an unauthenticated user", async () => {
    await expect(renderAdminRoute("feedback admin shell")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("does not render the feedback shell for a non-admin user", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "admin-user");
    mocks.getSupabaseUserFromCookies.mockResolvedValue({
      id: "user-1",
      email: "seller@example.com",
    });

    await expect(renderAdminRoute("feedback admin shell")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("fails closed for an authenticated user when no admin allowlist exists", async () => {
    mocks.getSupabaseUserFromCookies.mockResolvedValue({
      id: "admin-user",
      email: "owner@example.com",
    });

    await expect(renderAdminRoute("provider usage admin shell")).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
  });

  it("renders provider usage for an allow-listed admin", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "admin-user");
    mocks.getSupabaseUserFromCookies.mockResolvedValue({
      id: "admin-user",
      email: "owner@example.com",
    });

    await expect(renderAdminRoute("provider usage admin shell")).resolves.toBe(
      "provider usage admin shell",
    );
  });

  it("renders feedback for an allow-listed admin", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    mocks.getSupabaseUserFromCookies.mockResolvedValue({
      id: "admin-user",
      email: "owner@example.com",
    });

    await expect(renderAdminRoute("feedback admin shell")).resolves.toBe(
      "feedback admin shell",
    );
  });
});
