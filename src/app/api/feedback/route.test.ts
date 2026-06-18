import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));

import { AppError } from "@/lib/errors";

import { GET, POST } from "./route";

afterEach(() => vi.restoreAllMocks());

function req(body?: unknown) {
  return new Request("http://localhost/api/feedback", {
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const validBody = {
  type: "bug",
  severity: "high",
  subject: "Refresh crashed",
  message: "Clicking refresh threw.",
};

describe("POST /api/feedback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated submissions", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(new AppError("Sign in", 401));
    const res = await POST(req(validBody));
    expect(res.status).toBe(401);
  });

  it("creates feedback with the userId from the verified session", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "a@b.com" });
    const create = vi.fn().mockResolvedValue({ id: "fb-1" });
    mocks.getPrisma.mockReturnValue({ feedback: { create } });

    const res = await POST(req(validBody));

    expect(res.status).toBe(201);
    expect(create.mock.calls[0][0].data.userId).toBe("user-1");
    expect(create.mock.calls[0][0].data.subject).toBe("Refresh crashed");
  });

  it("rejects invalid input (bad type)", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    mocks.getPrisma.mockReturnValue({ feedback: { create: vi.fn() } });
    const res = await POST(req({ ...validBody, type: "spam" }));
    expect(res.status).toBe(400);
  });

  it("rejects a client-supplied userId (strict schema)", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    const create = vi.fn();
    mocks.getPrisma.mockReturnValue({ feedback: { create } });
    const res = await POST(req({ ...validBody, userId: "attacker" }));
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns a generic sanitized 500 for an unexpected database failure", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    const create = vi
      .fn()
      .mockRejectedValue(new Error("Prisma failed with token secret-db-token"));
    mocks.getPrisma.mockReturnValue({ feedback: { create } });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(req(validBody));
    const body = await res.text();

    expect(res.status).toBe(500);
    expect(body).toContain("feedback_submit_failed");
    expect(body).not.toContain("Prisma");
    expect(body).not.toContain("secret-db-token");
    expect(consoleError).toHaveBeenCalledWith("feedback_submit_failed");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret-db-token");
    consoleError.mockRestore();
  });
});

describe("GET /api/feedback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only the caller's own feedback", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    const findMany = vi.fn().mockResolvedValue([{ id: "fb-1", subject: "x" }]);
    mocks.getPrisma.mockReturnValue({ feedback: { findMany } });

    const res = await GET(req());
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload.rows).toHaveLength(1);
    expect(findMany.mock.calls[0][0].where).toEqual({ userId: "user-1" });
  });

  it("sanitizes unexpected feedback fetch failures", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    const findMany = vi.fn().mockRejectedValue(new Error("database host secret.internal"));
    mocks.getPrisma.mockReturnValue({ feedback: { findMany } });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req());
    const body = await res.text();

    expect(res.status).toBe(500);
    expect(body).toContain("feedback_fetch_failed");
    expect(body).not.toContain("secret.internal");
    expect(consoleError).toHaveBeenCalledWith("feedback_fetch_failed");
    consoleError.mockRestore();
  });
});
