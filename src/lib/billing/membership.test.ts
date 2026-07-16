import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  accountMemberIds,
  acceptInvite,
  assertCanManageAccount,
  inviteMember,
  revokeMember,
} from "./membership";

function fakePrisma(over: Record<string, ReturnType<typeof vi.fn>>) {
  const transaction = {
    accountMember: over,
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
  };
  return {
    ...transaction,
    $transaction: vi.fn(async (callback: (value: typeof transaction) => Promise<unknown>) =>
      callback(transaction),
    ),
  } as never;
}

describe("inviteMember", () => {
  it("creates an invited member when a seat is free", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const count = vi.fn().mockResolvedValue(0);
    const create = vi
      .fn()
      .mockResolvedValue({ id: "m1", userId: null, invitedEmail: "a@b.com", role: "member", status: "invited" });
    const prisma = fakePrisma({ findFirst, count, create });

    const member = await inviteMember({ id: "acc-1", plan: "kingpin" }, "A@B.com ", "member", prisma);

    expect(member.status).toBe("invited");
    expect(create.mock.calls[0][0].data.invitedEmail).toBe("a@b.com");
  });

  it("returns an existing pending invite instead of creating a duplicate", async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: "m1",
      userId: null,
      invitedEmail: "a@b.com",
      role: "member",
      status: "invited",
    });
    const create = vi.fn();
    const prisma = fakePrisma({ findFirst, count: vi.fn(), create });

    const member = await inviteMember({ id: "acc-1", plan: "kingpin" }, "A@B.com", "member", prisma);

    expect(member.id).toBe("m1");
    expect(create).not.toHaveBeenCalled();
  });

  it("blocks an invite once the plan's seats are full", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const count = vi.fn().mockResolvedValue(5); // kingpin = 5 seats
    const create = vi.fn();
    const prisma = fakePrisma({ findFirst, count, create });

    await expect(
      inviteMember({ id: "acc-1", plan: "kingpin" }, "x@y.com", "member", prisma),
    ).rejects.toMatchObject({ code: "SEAT_LIMIT_REACHED" });
    expect(create).not.toHaveBeenCalled();
  });

  it("serializes concurrent attempts for the final account seat", async () => {
    type TestMember = {
      id: string;
      accountId: string;
      userId: string | null;
      invitedEmail: string | null;
      role: string;
      status: string;
    };
    const rows: TestMember[] = Array.from({ length: 4 }, (_, index) => ({
      id: `existing-${index}`,
      accountId: "acc-1",
      userId: `user-${index}`,
      invitedEmail: null,
      role: index === 0 ? "owner" : "member",
      status: "active",
    }));
    let tail = Promise.resolve();
    const prisma = {
      $transaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) => {
        let release: () => void = () => {};
        const previous = tail;
        tail = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        const transaction = {
          $executeRawUnsafe: vi.fn().mockResolvedValue(1),
          accountMember: {
            findFirst: vi.fn(async (args: { where: { invitedEmail: string } }) =>
              rows.find((row) => row.invitedEmail === args.where.invitedEmail) ?? null,
            ),
            count: vi.fn(async () => rows.length),
            create: vi.fn(async (args: {
              data: {
                accountId: string;
                invitedEmail: string;
                role: string;
                status: string;
              };
            }) => {
              const created: TestMember = {
                id: `created-${rows.length}`,
                userId: null,
                ...args.data,
              };
              rows.push(created);
              return created;
            }),
          },
        };
        try {
          return await callback(transaction);
        } finally {
          release();
        }
      }),
    } as never;

    const outcomes = await Promise.allSettled([
      inviteMember({ id: "acc-1", plan: "kingpin" }, "first@example.com", "member", prisma),
      inviteMember({ id: "acc-1", plan: "kingpin" }, "second@example.com", "member", prisma),
    ]);

    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(rows).toHaveLength(5);
  });

  it("treats pro/free as a single seat", async () => {
    const prisma = fakePrisma({
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(1),
      create: vi.fn(),
    });
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
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ id: "m1", accountId: "acc-1", invitedEmail: "a@b.com", status: "invited" })
      .mockResolvedValueOnce(null);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi
      .fn()
      .mockResolvedValue({ id: "m1", userId: "user-9", invitedEmail: "a@b.com", role: "member", status: "active" });
    const prisma = fakePrisma({ findFirst, updateMany, findUnique });

    const member = await acceptInvite("user-9", "A@B.com", prisma);

    expect(member?.status).toBe("active");
    expect(updateMany.mock.calls[0][0]).toEqual({
      where: { id: "m1", status: "invited" },
      data: { userId: "user-9", status: "active" },
    });
  });

  it("returns null when there is no invite", async () => {
    const prisma = fakePrisma({ findFirst: vi.fn().mockResolvedValue(null), updateMany: vi.fn() });
    expect(await acceptInvite("user-9", "none@x.com", prisma)).toBeNull();
  });

  it("revokes a duplicate pending invite when the user is already active", async () => {
    const findFirst = vi.fn()
      .mockResolvedValueOnce({ id: "invite-2", accountId: "acc-1", invitedEmail: "a@b.com", role: "member", status: "invited" })
      .mockResolvedValueOnce({ id: "active-1", accountId: "acc-1", userId: "user-9", invitedEmail: "a@b.com", role: "member", status: "active" });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const prisma = fakePrisma({ findFirst, updateMany });

    const member = await acceptInvite("user-9", "A@B.com", prisma);

    expect(member?.id).toBe("active-1");
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "invite-2", status: "invited" },
      data: { status: "revoked", userId: null },
    });
  });

  it("does not reactivate an invite that was revoked concurrently", async () => {
    const findFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: "m1", accountId: "acc-1", invitedEmail: "a@b.com", status: "invited" })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const prisma = fakePrisma({ findFirst, updateMany, findUnique: vi.fn() });

    await expect(acceptInvite("user-9", "A@B.com", prisma)).resolves.toBeNull();
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "m1", status: "invited" },
      data: { userId: "user-9", status: "active" },
    });
  });
});

describe("assertCanManageAccount", () => {
  it("allows the account owner", async () => {
    const prisma = fakePrisma({ findFirst: vi.fn() });
    await expect(
      assertCanManageAccount({ id: "acc-1", ownerUserId: "owner-1" }, "owner-1", prisma),
    ).resolves.toBeUndefined();
  });

  it("allows active admins", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "admin-1" });
    const prisma = fakePrisma({ findFirst });

    await expect(
      assertCanManageAccount({ id: "acc-1", ownerUserId: "owner-1" }, "admin-1", prisma),
    ).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledWith({
      where: { accountId: "acc-1", userId: "admin-1", status: "active", role: "admin" },
      select: { id: true },
    });
  });

  it("denies regular members", async () => {
    const prisma = fakePrisma({ findFirst: vi.fn().mockResolvedValue(null) });
    await expect(
      assertCanManageAccount({ id: "acc-1", ownerUserId: "owner-1" }, "member-1", prisma),
    ).rejects.toMatchObject({ code: "ACCOUNT_MANAGEMENT_FORBIDDEN", status: 403 });
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
