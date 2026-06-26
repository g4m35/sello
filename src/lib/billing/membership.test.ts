import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  accountMemberIds,
  acceptInvite,
  inviteMember,
  revokeMember,
} from "./membership";

function fakePrisma(over: Record<string, ReturnType<typeof vi.fn>>) {
  return { accountMember: over } as never;
}

describe("inviteMember", () => {
  it("creates an invited member when a seat is free", async () => {
    const count = vi.fn().mockResolvedValue(0);
    const create = vi
      .fn()
      .mockResolvedValue({ id: "m1", userId: null, invitedEmail: "a@b.com", role: "member", status: "invited" });
    const prisma = fakePrisma({ count, create });

    const member = await inviteMember({ id: "acc-1", plan: "kingpin" }, "A@B.com ", "member", prisma);

    expect(member.status).toBe("invited");
    expect(create.mock.calls[0][0].data.invitedEmail).toBe("a@b.com");
  });

  it("blocks an invite once the plan's seats are full", async () => {
    const count = vi.fn().mockResolvedValue(5); // kingpin = 5 seats
    const create = vi.fn();
    const prisma = fakePrisma({ count, create });

    await expect(
      inviteMember({ id: "acc-1", plan: "kingpin" }, "x@y.com", "member", prisma),
    ).rejects.toMatchObject({ code: "SEAT_LIMIT_REACHED" });
    expect(create).not.toHaveBeenCalled();
  });

  it("treats pro/free as a single seat", async () => {
    const prisma = fakePrisma({ count: vi.fn().mockResolvedValue(1), create: vi.fn() });
    await expect(
      inviteMember({ id: "acc-1", plan: "pro" }, "x@y.com", "member", prisma),
    ).rejects.toMatchObject({ code: "SEAT_LIMIT_REACHED" });
  });

  it("rejects an invalid email", async () => {
    const prisma = fakePrisma({ count: vi.fn().mockResolvedValue(0), create: vi.fn() });
    await expect(
      inviteMember({ id: "acc-1", plan: "kingpin" }, "not-an-email", "member", prisma),
    ).rejects.toMatchObject({ code: "INVALID_INVITE_EMAIL" });
  });
});

describe("acceptInvite", () => {
  it("binds the user to a matching pending invite", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "m1", invitedEmail: "a@b.com", status: "invited" });
    const update = vi
      .fn()
      .mockResolvedValue({ id: "m1", userId: "user-9", invitedEmail: "a@b.com", role: "member", status: "active" });
    const prisma = fakePrisma({ findFirst, update });

    const member = await acceptInvite("user-9", "A@B.com", prisma);

    expect(member?.status).toBe("active");
    expect(update.mock.calls[0][0].data).toEqual({ userId: "user-9", status: "active" });
  });

  it("returns null when there is no invite", async () => {
    const prisma = fakePrisma({ findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() });
    expect(await acceptInvite("user-9", "none@x.com", prisma)).toBeNull();
  });
});

describe("revokeMember", () => {
  it("revokes a member and frees the seat", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "m1", accountId: "acc-1", role: "member" });
    const update = vi.fn().mockResolvedValue({});
    const prisma = fakePrisma({ findFirst, update });

    await revokeMember({ id: "acc-1" }, "m1", prisma);

    expect(update.mock.calls[0][0].data).toEqual({ status: "revoked", userId: null });
  });

  it("refuses to remove the owner", async () => {
    const prisma = fakePrisma({
      findFirst: vi.fn().mockResolvedValue({ id: "m1", accountId: "acc-1", role: "owner" }),
      update: vi.fn(),
    });
    await expect(revokeMember({ id: "acc-1" }, "m1", prisma)).rejects.toMatchObject({
      code: "CANNOT_REMOVE_OWNER",
    });
  });
});

describe("accountMemberIds", () => {
  it("returns active member user ids only", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ userId: "u1" }, { userId: "u2" }]);
    const prisma = fakePrisma({ findMany });
    expect(await accountMemberIds("acc-1", prisma)).toEqual(["u1", "u2"]);
  });
});
