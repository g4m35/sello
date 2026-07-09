import { describe, expect, it, vi } from "vitest";

import { accountWithEffectivePlan, effectivePlanForUser } from "./effective-plan";

vi.mock("server-only", () => ({}));

describe("effectivePlanForUser", () => {
  it("keeps a normal user's account plan", () => {
    expect(
      effectivePlanForUser(
        { plan: "free" },
        { id: "user-1", email: "seller@example.com" },
        { ADMIN_EMAILS: "owner@example.com" },
      ),
    ).toBe("free");
  });

  it("uses kingpin limits for allow-listed admins without mutating the account", () => {
    const account = { id: "acc-1", plan: "free" as const };
    const effective = accountWithEffectivePlan(
      account,
      { id: "user-1", email: "owner@example.com" },
      { ADMIN_EMAILS: "owner@example.com" },
    );

    expect(effective).toEqual({ id: "acc-1", plan: "kingpin" });
    expect(account.plan).toBe("free");
  });
});
