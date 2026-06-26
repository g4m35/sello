import { describe, expect, it, vi } from "vitest";

import type { getPrisma } from "@/lib/prisma";

vi.mock("server-only", () => ({}));

import { getActiveAccount, getOrCreateAccount } from "./account";

type Db = ReturnType<typeof getPrisma>;

function fakePrisma(overrides: {
  findUnique?: ReturnType<typeof vi.fn>;
  create?: ReturnType<typeof vi.fn>;
}): Db {
  return {
    account: {
      findUnique: overrides.findUnique ?? vi.fn(),
      create: overrides.create ?? vi.fn(),
    },
  } as unknown as Db;
}

describe("getOrCreateAccount", () => {
  it("returns the existing account without creating", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "acc-1",
      ownerUserId: "user-1",
      plan: "pro",
    });
    const create = vi.fn();
    const prisma = fakePrisma({ findUnique, create });

    const account = await getOrCreateAccount("user-1", prisma);

    expect(account).toEqual({ id: "acc-1", ownerUserId: "user-1", plan: "pro" });
    expect(create).not.toHaveBeenCalled();
  });

  it("creates an account with an active owner member when none exists", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({
      id: "acc-2",
      ownerUserId: "user-2",
      plan: "free",
    });
    const prisma = fakePrisma({ findUnique, create });

    const account = await getOrCreateAccount("user-2", prisma);

    expect(account).toEqual({ id: "acc-2", ownerUserId: "user-2", plan: "free" });
    expect(create).toHaveBeenCalledTimes(1);
    const arg = create.mock.calls[0][0];
    expect(arg.data.ownerUserId).toBe("user-2");
    expect(arg.data.members.create).toMatchObject({
      userId: "user-2",
      role: "owner",
      status: "active",
    });
  });

  it("recovers from a unique-violation race by re-fetching", async () => {
    const found = { id: "acc-3", ownerUserId: "user-3", plan: "free" };
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(found);
    const create = vi.fn().mockRejectedValue(
      Object.assign(new Error("unique"), { code: "P2002" }),
    );
    const prisma = fakePrisma({ findUnique, create });

    const account = await getOrCreateAccount("user-3", prisma);

    expect(account).toEqual(found);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});

describe("getActiveAccount", () => {
  function db(parts: {
    accountFind?: ReturnType<typeof vi.fn>;
    memberFind?: ReturnType<typeof vi.fn>;
    accountCreate?: ReturnType<typeof vi.fn>;
  }): Db {
    return {
      account: {
        findUnique: parts.accountFind ?? vi.fn().mockResolvedValue(null),
        create: parts.accountCreate ?? vi.fn(),
      },
      accountMember: {
        findFirst: parts.memberFind ?? vi.fn().mockResolvedValue(null),
      },
    } as unknown as Db;
  }

  it("returns the account the user owns (unchanged for existing users)", async () => {
    const accountFind = vi
      .fn()
      .mockResolvedValue({ id: "acc-own", ownerUserId: "user-1", plan: "pro" });
    const memberFind = vi.fn();
    const account = await getActiveAccount("user-1", db({ accountFind, memberFind }));

    expect(account).toEqual({ id: "acc-own", ownerUserId: "user-1", plan: "pro" });
    expect(memberFind).not.toHaveBeenCalled();
  });

  it("returns the shared account an invitee is an active member of", async () => {
    const accountFind = vi.fn().mockResolvedValue(null);
    const memberFind = vi.fn().mockResolvedValue({
      account: { id: "acc-team", ownerUserId: "owner-9", plan: "kingpin" },
    });
    const account = await getActiveAccount("invitee-2", db({ accountFind, memberFind }));

    expect(account).toEqual({ id: "acc-team", ownerUserId: "owner-9", plan: "kingpin" });
  });

  it("creates a personal account when the user has none", async () => {
    const accountCreate = vi
      .fn()
      .mockResolvedValue({ id: "acc-new", ownerUserId: "fresh-3", plan: "free" });
    const account = await getActiveAccount("fresh-3", db({ accountCreate }));

    expect(account).toEqual({ id: "acc-new", ownerUserId: "fresh-3", plan: "free" });
    expect(accountCreate).toHaveBeenCalledTimes(1);
  });
});
