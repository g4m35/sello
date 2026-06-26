import "server-only";

import { getPrisma } from "@/lib/prisma";

import { connectionLimitReached } from "./errors";
import { limitsFor, type PlanId } from "./plans";

type Db = ReturnType<typeof getPrisma>;

// Blocks connecting a NEW marketplace once the account is at its plan's
// connection limit. Reconnecting a marketplace the account already has is always
// allowed (it does not increase the distinct count). Phase 2 scopes by the
// account owner; seats widen this to all members later.
export async function assertCanConnectMarketplace(
  account: { ownerUserId: string; plan: PlanId },
  marketplace: string,
  prisma: Db = getPrisma(),
): Promise<void> {
  const limit = limitsFor(account.plan).marketplaceConnections;

  const connected = await prisma.marketplaceConnection.findMany({
    where: { userId: account.ownerUserId },
    select: { marketplace: true },
    distinct: ["marketplace"],
  });

  const marketplaces = new Set<string>(connected.map((row) => row.marketplace));
  if (marketplaces.has(marketplace)) return;
  if (marketplaces.size >= limit) throw connectionLimitReached(limit);
}
