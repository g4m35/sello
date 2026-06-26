import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

vi.mock("server-only", () => ({}));

import { assertCanConnectMarketplace } from "./connections";

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
      assertCanConnectMarketplace({ ownerUserId: "u1", plan: "free" }, "ebay", prisma),
    ).resolves.toBeUndefined();
  });

  it("blocks a new marketplace at the free limit of 1", async () => {
    const { prisma } = prismaWith(["ebay"]);
    await expect(
      assertCanConnectMarketplace({ ownerUserId: "u1", plan: "free" }, "etsy", prisma),
    ).rejects.toMatchObject({ code: "CONNECTION_LIMIT_REACHED" });
  });

  it("always allows reconnecting a marketplace already connected", async () => {
    const { prisma } = prismaWith(["ebay"]);
    await expect(
      assertCanConnectMarketplace({ ownerUserId: "u1", plan: "free" }, "ebay", prisma),
    ).resolves.toBeUndefined();
  });

  it("lets pro connect a 3rd distinct marketplace but blocks a 4th", async () => {
    const at3 = prismaWith(["ebay", "etsy", "depop"]);
    await expect(
      assertCanConnectMarketplace({ ownerUserId: "u1", plan: "pro" }, "grailed", at3.prisma),
    ).rejects.toBeInstanceOf(AppError);

    const at2 = prismaWith(["ebay", "etsy"]);
    await expect(
      assertCanConnectMarketplace({ ownerUserId: "u1", plan: "pro" }, "depop", at2.prisma),
    ).resolves.toBeUndefined();
  });
});
