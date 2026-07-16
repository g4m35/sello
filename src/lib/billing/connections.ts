import "server-only";

import { isAdminUser } from "@/lib/auth/admin";
import { AppError } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";

import { connectionLimitReached } from "./errors";
import { limitsFor, type PlanId } from "./plans";

type Db = ReturnType<typeof getPrisma>;
type AdminCheckUser = { id?: string | null; email?: string | null };

export type MarketplaceConnectionAccount = {
  id: string;
  ownerUserId: string;
  plan: PlanId;
};

export async function assertCanManageMarketplaceConnections(
  account: { id: string; ownerUserId: string },
  userId: string,
  prisma: Db = getPrisma(),
): Promise<void> {
  if (account.ownerUserId === userId) return;

  const membership = await prisma.accountMember.findFirst({
    where: {
      accountId: account.id,
      userId,
      status: "active",
      role: "admin",
    },
    select: { id: true },
  });
  if (membership) return;

  throw new AppError(
    "Only account owners and admins can manage marketplace connections.",
    403,
    "MARKETPLACE_CONNECTION_MANAGEMENT_FORBIDDEN",
  );
}

// Blocks connecting a NEW marketplace once the account is at its plan's
// connection limit. Reconnecting a marketplace the account already has is always
// allowed (it does not increase the distinct count).
export async function assertCanConnectMarketplace(
  account: MarketplaceConnectionAccount,
  marketplace: string,
  prisma: Db = getPrisma(),
  user?: AdminCheckUser,
): Promise<void> {
  const limit = limitsFor(account.plan).marketplaceConnections;

  const connected = await prisma.marketplaceConnection.findMany({
    where: { accountId: account.id },
    select: { marketplace: true },
    distinct: ["marketplace"],
  });

  const marketplaces = new Set<string>(connected.map((row) => row.marketplace));
  if (marketplaces.has(marketplace)) return;
  if (user && isAdminUser(user)) return;
  if (marketplaces.size >= limit) throw connectionLimitReached(limit);
}
