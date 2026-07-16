import "server-only";

import { decideEntitlement } from "@/lib/auth/entitlement-decision";
import { AppError } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";

import type { PlanId } from "./plans";

export interface AccountRecord {
  id: string;
  ownerUserId: string;
  plan: PlanId;
}

type Db = ReturnType<typeof getPrisma>;

interface RawAccount {
  id: string;
  ownerUserId: string;
  plan: string;
  disabledAt?: Date | null;
}

function toRecord(account: RawAccount): AccountRecord {
  // PlanTier enum values ("free" | "pro" | "kingpin") are identical to PlanId.
  return { id: account.id, ownerUserId: account.ownerUserId, plan: account.plan as PlanId };
}

function toActiveRecord(account: RawAccount): AccountRecord {
  const decision = decideEntitlement({
    plan: account.plan as PlanId,
    accountEnabled: !account.disabledAt,
  });
  if (!decision.allowed) {
    throw new AppError(decision.sellerCopy, 403, decision.reason);
  }
  return toRecord(account);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

// Returns the user's personal account, creating it (with an active owner member)
// on first call. Idempotent and race-safe: a concurrent create that loses the
// unique-ownerUserId race re-fetches the winner instead of throwing.
export async function getOrCreateAccount(
  userId: string,
  prisma: Db = getPrisma(),
): Promise<AccountRecord> {
  const existing = await prisma.account.findUnique({ where: { ownerUserId: userId } });
  if (existing) return toActiveRecord(existing);

  try {
    const created = await prisma.account.create({
      data: {
        ownerUserId: userId,
        members: { create: { userId, role: "owner", status: "active" } },
      },
    });
    return toActiveRecord(created);
  } catch (error) {
    if (isUniqueViolation(error)) {
      const found = await prisma.account.findUnique({ where: { ownerUserId: userId } });
      if (found) return toActiveRecord(found);
    }
    throw error;
  }
}

// The account whose data and billing the user acts under. Prefers an account
// the user owns (their primary workspace, unchanged for existing users), then an
// account they were invited to and are an active member of, otherwise creates
// their personal account. Returning a shared account is how invited members see
// the same inventory.
export async function getActiveAccount(
  userId: string,
  prisma: Db = getPrisma(),
): Promise<AccountRecord> {
  const owned = await prisma.account.findUnique({ where: { ownerUserId: userId } });
  if (owned) return toActiveRecord(owned);

  const membership = await prisma.accountMember.findFirst({
    where: { userId, status: "active" },
    orderBy: { createdAt: "asc" },
    include: { account: true },
  });
  if (membership?.account) return toActiveRecord(membership.account);

  return getOrCreateAccount(userId, prisma);
}
