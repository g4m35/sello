import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));

import { PATCH } from "./route";

const VALID_ID = "11111111-1111-4111-8111-111111111111";

function ctx(id = VALID_ID) {
  return { params: Promise.resolve({ id }) };
}
function req(body: unknown) {
  return new Request(`http://localhost/api/admin/feedback/${VALID_ID}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/admin/feedback/[id]", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns 404 for a non-admin", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "a@b.com" });
    const res = await PATCH(req({ status: "resolved" }), ctx());
    expect(res.status).toBe(404);
  });

  it("lets an admin update status", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "u1");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1", email: "a@b.com" });
    const update = vi.fn().mockResolvedValue({ id: "fb-1", status: "resolved" });
    mocks.getPrisma.mockReturnValue({ feedback: { update } });

    const res = await PATCH(req({ status: "resolved" }), ctx());

    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0]).toMatchObject({
      where: { id: VALID_ID },
      data: { status: "resolved" },
    });
  });

  it("rejects an invalid status for an admin", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "u1");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1" });
    mocks.getPrisma.mockReturnValue({ feedback: { update: vi.fn() } });
    const res = await PATCH(req({ status: "spam" }), ctx());
    expect(res.status).toBe(400);
  });

  it("rejects a malformed feedback id before database access", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "u1");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1" });
    const update = vi.fn();
    mocks.getPrisma.mockReturnValue({ feedback: { update } });

    const res = await PATCH(req({ status: "resolved" }), ctx("not-a-uuid"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_feedback_id" });
    expect(update).not.toHaveBeenCalled();
  });

  it("returns a generic sanitized 500 for unexpected database failures", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "u1");
    mocks.requireSupabaseUser.mockResolvedValue({ id: "u1" });
    const update = vi
      .fn()
      .mockRejectedValue(new Error("Prisma query leaked token secret-admin-token"));
    mocks.getPrisma.mockReturnValue({ feedback: { update } });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await PATCH(req({ status: "resolved" }), ctx());
    const body = await res.text();

    expect(res.status).toBe(500);
    expect(body).toContain("admin_feedback_update_failed");
    expect(body).not.toContain("Prisma");
    expect(body).not.toContain("secret-admin-token");
    expect(consoleError).toHaveBeenCalledWith("admin_feedback_update_failed");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("secret-admin-token");
    consoleError.mockRestore();
  });
});
