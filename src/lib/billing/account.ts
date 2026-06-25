import "server-only";

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
}

function toRecord(account: RawAccount): AccountRecord {
  // PlanTier enum values ("free" | "pro" | "kingpin") are identical to PlanId.
  return { id: account.id, ownerUserId: account.ownerUserId, plan: account.plan as PlanId };
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
  if (existing) return toRecord(existing);

  try {
    const created = await prisma.account.create({
      data: {
        ownerUserId: userId,
        members: { create: { userId, role: "owner", status: "active" } },
      },
    });
    return toRecord(created);
  } catch (error) {
    if (isUniqueViolation(error)) {
      const found = await prisma.account.findUnique({ where: { ownerUserId: userId } });
      if (found) return toRecord(found);
    }
    throw error;
  }
}

// The account whose data and billing the user acts under. Phase 1: the user's
// own account. (Widened to active membership when team seats ship.)
export async function getActiveAccount(
  userId: string,
  prisma: Db = getPrisma(),
): Promise<AccountRecord> {
  return getOrCreateAccount(userId, prisma);
}
