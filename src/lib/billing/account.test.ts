import { describe, expect, it, vi } from "vitest";

import type { getPrisma } from "@/lib/prisma";

vi.mock("server-only", () => ({}));

import { getOrCreateAccount } from "./account";

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
