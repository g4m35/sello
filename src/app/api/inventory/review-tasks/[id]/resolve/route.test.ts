import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireUser: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({
  requireSupabaseUserFromRequestOrCookies: mocks.requireUser,
}));

import { POST } from "./route";

const TASK_ID = "22222222-2222-4222-8222-222222222222";

function ctx(id: string = TASK_ID) {
  return { params: Promise.resolve({ id }) };
}

function req(body: unknown): Request {
  return new Request(`http://localhost/api/inventory/review-tasks/${TASK_ID}/resolve`, {
    method: "POST",
    headers: { authorization: "Bearer t" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/inventory/review-tasks/[id]/resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: "user-1" });
    mocks.getPrisma.mockReturnValue({ reviewTask: { updateMany: mocks.updateMany } });
  });
  afterEach(() => vi.clearAllMocks());

  it("requires authentication", async () => {
    mocks.requireUser.mockRejectedValue(new AppError("Sign in.", 401));
    const res = await POST(req({ status: "resolved" }), ctx());
    expect(res.status).toBe(401);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it("resolves a task scoped to the signed-in user and stamps resolvedAt", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    const res = await POST(req({ status: "resolved" }), ctx());
    const payload = await res.json();

    expect(res.status).toBe(200);
    expect(payload).toEqual({ ok: true, id: TASK_ID, status: "resolved" });
    const arg = mocks.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: TASK_ID, userId: "user-1", status: "open" });
    expect(arg.data.status).toBe("resolved");
    expect(arg.data.resolvedAt).toBeInstanceOf(Date);
  });

  it("404s when the task is not owned by the user (count 0) — ownership guard", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const res = await POST(req({ status: "dismissed" }), ctx());
    expect(res.status).toBe(404);
    // Scoped by userId, so a foreign task can never be closed.
    expect(mocks.updateMany.mock.calls[0][0].where.userId).toBe("user-1");
  });

  it("rejects an invalid status with 400 before any DB work", async () => {
    const res = await POST(req({ status: "archived" }), ctx());
    expect(res.status).toBe(400);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
