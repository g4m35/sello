import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
  listMembers: vi.fn(),
  inviteMember: vi.fn(),
  assertCanManageAccount: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/billing/membership", () => ({
  assertCanManageAccount: mocks.assertCanManageAccount,
  listMembers: mocks.listMembers,
  inviteMember: mocks.inviteMember,
}));

import { AppError } from "@/lib/errors";

import { GET, POST } from "./route";

function req(body?: unknown) {
  return new Request("http://localhost/api/account/members", {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1", email: "owner@e.com" });
  mocks.getActiveAccount.mockResolvedValue({ id: "acc-1", ownerUserId: "user-1", plan: "kingpin" });
  mocks.assertCanManageAccount.mockResolvedValue(undefined);
});

describe("account members route", () => {
  it("lists members", async () => {
    mocks.listMembers.mockResolvedValue([{ id: "m1", role: "owner", status: "active" }]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect((await res.json()).members).toHaveLength(1);
  });

  it("invites a member", async () => {
    mocks.inviteMember.mockResolvedValue({ id: "m2", invitedEmail: "a@b.com", status: "invited" });
    const res = await POST(req({ email: "a@b.com", role: "member" }));
    expect(res.status).toBe(201);
    expect(mocks.assertCanManageAccount).toHaveBeenCalledWith(
      { id: "acc-1", ownerUserId: "user-1", plan: "kingpin" },
      "user-1",
    );
    expect(mocks.inviteMember).toHaveBeenCalledWith(
      { id: "acc-1", ownerUserId: "user-1", plan: "kingpin" },
      "a@b.com",
      "member",
    );
  });

  it("denies invite creation for non-admin members", async () => {
    mocks.assertCanManageAccount.mockRejectedValue(
      new AppError(
        "Only account owners and admins can manage this account.",
        403,
        "ACCOUNT_MANAGEMENT_FORBIDDEN",
      ),
    );

    const res = await POST(req({ email: "a@b.com", role: "admin" }));

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("ACCOUNT_MANAGEMENT_FORBIDDEN");
    expect(mocks.inviteMember).not.toHaveBeenCalled();
  });

  it("surfaces the seat-limit error from invite", async () => {
    mocks.inviteMember.mockRejectedValue(
      new AppError("Your plan includes 5 seats. Upgrade to add more.", 403, "SEAT_LIMIT_REACHED"),
    );
    const res = await POST(req({ email: "a@b.com" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("SEAT_LIMIT_REACHED");
  });

  it("rejects an invalid invite email at the boundary", async () => {
    const res = await POST(req({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(mocks.inviteMember).not.toHaveBeenCalled();
  });
});
