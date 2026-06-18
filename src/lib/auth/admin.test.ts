import { describe, expect, it } from "vitest";

import { isAdminUser } from "@/lib/auth/admin";

describe("isAdminUser", () => {
  it("fails closed when no allowlist is configured", () => {
    expect(isAdminUser({ id: "u1", email: "a@b.com" }, {})).toBe(false);
  });

  it("allows a user whose id is in ADMIN_USER_IDS", () => {
    expect(
      isAdminUser({ id: "u1", email: "a@b.com" }, { ADMIN_USER_IDS: "u9, u1 ,u2" }),
    ).toBe(true);
  });

  it("allows a user whose email is in ADMIN_EMAILS (case-insensitive)", () => {
    expect(
      isAdminUser({ id: "u1", email: "Owner@Sello.com" }, { ADMIN_EMAILS: "owner@sello.com" }),
    ).toBe(true);
  });

  it("rejects a user not in either allowlist", () => {
    expect(
      isAdminUser(
        { id: "u1", email: "a@b.com" },
        { ADMIN_USER_IDS: "u2", ADMIN_EMAILS: "owner@sello.com" },
      ),
    ).toBe(false);
  });

  it("rejects when the user has no id/email even if an allowlist exists", () => {
    expect(isAdminUser({ id: null, email: null }, { ADMIN_EMAILS: "owner@sello.com" })).toBe(false);
    expect(isAdminUser({}, { ADMIN_EMAILS: "owner@sello.com" })).toBe(false);
  });
});
