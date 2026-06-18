import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));

import { AppError } from "@/lib/errors";

import { GET } from "./route";

function req(query = "") {
  return new Request(`http://localhost/api/admin/feedback${query}`);
}

describe("GET /api/admin/feedback", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("rejects unauthenticated requests", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(new AppError("Sign in", 401));
    expect((await GET(req())).status).toBe(401);
  });

  it("returns 404 for a non-admin (no allowlist)", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    const res = await GET(req());
    expect(res.status).toBe(404);
  });

  it("returns all feedback for an allow-listed admin", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@sello.com");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "owner@sello.com" });
    const findMany = vi.fn().mockResolvedValue([{ id: "fb-1", subject: "x", status: "open" }]);
    const count = vi.fn().mockResolvedValue(1);
    mocks.getPrisma.mockReturnValue({ feedback: { findMany, count } });

    const res = await GET(req("?status=open"));
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.rows).toHaveLength(1);
    expect(payload.openCount).toBe(1);
    expect(findMany.mock.calls[0][0].where).toMatchObject({ status: "open" });
  });

  it("ignores an invalid status filter rather than passing it through", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@sello.com");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "owner@sello.com" });
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    mocks.getPrisma.mockReturnValue({ feedback: { findMany, count } });

    await GET(req("?status=DROP TABLE"));
    expect(findMany.mock.calls[0][0].where.status).toBeUndefined();
  });

  it("returns a generic sanitized 500 for unexpected database failures", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@example.com");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "owner@example.com" });
    const findMany = vi.fn().mockRejectedValue(new Error("database secret value"));
    const count = vi.fn().mockResolvedValue(0);
    mocks.getPrisma.mockReturnValue({ feedback: { findMany, count } });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req());
    const body = await res.text();

    expect(res.status).toBe(500);
    expect(body).toContain("admin_feedback_fetch_failed");
    expect(body).not.toContain("database secret value");
    expect(consoleError).toHaveBeenCalledWith("admin_feedback_fetch_failed");
    consoleError.mockRestore();
  });
});
