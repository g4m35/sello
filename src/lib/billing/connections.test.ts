import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

vi.mock("server-only", () => ({}));

import {
  assertCanConnectMarketplace,
  assertCanManageMarketplaceConnections,
} from "./connections";

function prismaWith(marketplaces: string[]) {
  const findMany = vi
    .fn()
    .mockResolvedValue(marketplaces.map((marketplace) => ({ marketplace })));
  return { prisma: { marketplaceConnection: { findMany } } as never, findMany };
}

describe("assertCanConnectMarketplace", () => {
  it("allows a new connection below the plan limit", async () => {
    const { prisma } = prismaWith([]);
    await expect(
      assertCanConnectMarketplace({ id: "acc-1", ownerUserId: "u1", plan: "free" }, "ebay", prisma),
    ).resolves.toBeUndefined();
  });

  it("blocks a new marketplace at the free limit of 1", async () => {
    const { prisma } = prismaWith(["ebay"]);
    await expect(
      assertCanConnectMarketplace({ id: "acc-1", ownerUserId: "u1", plan: "free" }, "etsy", prisma),
    ).rejects.toMatchObject({ code: "CONNECTION_LIMIT_REACHED" });
  });

  it("lets server admins connect another marketplace even when the account is at its plan limit", async () => {
    vi.stubEnv("ADMIN_EMAILS", "owner@sello.com");
    const { prisma } = prismaWith(["ebay"]);

    await expect(
      assertCanConnectMarketplace(
        { id: "acc-1", ownerUserId: "u1", plan: "free" },
        "stockx",
        prisma,
        { id: "u1", email: "owner@sello.com" },
      ),
    ).resolves.toBeUndefined();
  });

  it("always allows reconnecting a marketplace already connected", async () => {
    const { prisma } = prismaWith(["ebay"]);
    await expect(
      assertCanConnectMarketplace({ id: "acc-1", ownerUserId: "u1", plan: "free" }, "ebay", prisma),
    ).resolves.toBeUndefined();
  });

  it("lets pro connect a 3rd distinct marketplace but blocks a 4th", async () => {
    const at3 = prismaWith(["ebay", "etsy", "depop"]);
    await expect(
      assertCanConnectMarketplace({ id: "acc-1", ownerUserId: "u1", plan: "pro" }, "grailed", at3.prisma),
    ).rejects.toBeInstanceOf(AppError);

    const at2 = prismaWith(["ebay", "etsy"]);
    await expect(
      assertCanConnectMarketplace({ id: "acc-1", ownerUserId: "u1", plan: "pro" }, "depop", at2.prisma),
    ).resolves.toBeUndefined();
  });

  it("counts distinct marketplace choices at account scope", async () => {
    const { prisma, findMany } = prismaWith(["ebay", "etsy"]);

    await assertCanConnectMarketplace(
      { id: "acc-team", ownerUserId: "owner-1", plan: "pro" },
      "depop",
      prisma,
    );

    expect(findMany).toHaveBeenCalledWith({
      where: { accountId: "acc-team" },
      select: { marketplace: true },
      distinct: ["marketplace"],
    });
  });
});

describe("assertCanManageMarketplaceConnections", () => {
  it("allows the account owner", async () => {
    const prisma = { accountMember: { findFirst: vi.fn() } } as never;

    await expect(
      assertCanManageMarketplaceConnections(
        { id: "acc-1", ownerUserId: "owner-1" },
        "owner-1",
        prisma,
      ),
    ).resolves.toBeUndefined();
  });

  it("allows an active account admin", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: "member-1" });
    const prisma = { accountMember: { findFirst } } as never;

    await expect(
      assertCanManageMarketplaceConnections(
        { id: "acc-1", ownerUserId: "owner-1" },
        "admin-1",
        prisma,
      ),
    ).resolves.toBeUndefined();
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        accountId: "acc-1",
        userId: "admin-1",
        status: "active",
        role: "admin",
      },
      select: { id: true },
    });
  });

  it("denies a regular member or revoked member", async () => {
    const prisma = { accountMember: { findFirst: vi.fn().mockResolvedValue(null) } } as never;

    await expect(
      assertCanManageMarketplaceConnections(
        { id: "acc-1", ownerUserId: "owner-1" },
        "member-1",
        prisma,
      ),
    ).rejects.toMatchObject({
      code: "MARKETPLACE_CONNECTION_MANAGEMENT_FORBIDDEN",
      status: 403,
    });
  });
});
