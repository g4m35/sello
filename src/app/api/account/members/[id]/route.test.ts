import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupabaseUser: vi.fn(),
  getActiveAccount: vi.fn(),
  assertCanManageAccount: vi.fn(),
  revokeMember: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.getActiveAccount }));
vi.mock("@/lib/billing/membership", () => ({
  assertCanManageAccount: mocks.assertCanManageAccount,
  revokeMember: mocks.revokeMember,
}));

import { AppError } from "@/lib/errors";

import { DELETE } from "./route";

const request = new Request("http://localhost/api/account/members/member-2", {
  method: "DELETE",
});
const context = { params: Promise.resolve({ id: "member-2" }) };

describe("account member revoke route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupabaseUser.mockResolvedValue({ id: "owner-1" });
    mocks.getActiveAccount.mockResolvedValue({
      id: "account-1",
      ownerUserId: "owner-1",
      plan: "kingpin",
    });
    mocks.assertCanManageAccount.mockResolvedValue(undefined);
    mocks.revokeMember.mockResolvedValue(undefined);
  });

  it("authorizes account management before revoking a member", async () => {
    const response = await DELETE(request, context);

    expect(response.status).toBe(200);
    expect(mocks.assertCanManageAccount).toHaveBeenCalledWith(
      { id: "account-1", ownerUserId: "owner-1", plan: "kingpin" },
      "owner-1",
    );
    expect(mocks.revokeMember).toHaveBeenCalledWith(
      { id: "account-1", ownerUserId: "owner-1", plan: "kingpin" },
      "member-2",
    );
  });

  it("denies regular members before any revoke mutation", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "member-1" });
    mocks.getActiveAccount.mockResolvedValue({
      id: "account-1",
      ownerUserId: "owner-1",
      plan: "kingpin",
    });
    mocks.assertCanManageAccount.mockRejectedValue(
      new AppError(
        "Only account owners and admins can manage this account.",
        403,
        "ACCOUNT_MANAGEMENT_FORBIDDEN",
      ),
    );

    const response = await DELETE(request, context);

    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("ACCOUNT_MANAGEMENT_FORBIDDEN");
    expect(mocks.revokeMember).not.toHaveBeenCalled();
  });
});
