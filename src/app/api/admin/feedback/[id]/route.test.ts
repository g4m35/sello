import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));

import { PATCH } from "./route";

function ctx(id = "fb-1") {
  return { params: Promise.resolve({ id }) };
}
function req(body: unknown) {
  return new Request("http://localhost/api/admin/feedback/fb-1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/admin/feedback/[id]", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());

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
      where: { id: "fb-1" },
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
});
