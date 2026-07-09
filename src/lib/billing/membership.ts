import "server-only";

import { AppError } from "@/lib/errors";
import { getPrisma } from "@/lib/prisma";

import { limitsFor, type PlanId } from "./plans";

type Db = ReturnType<typeof getPrisma>;

export type MemberRole = "owner" | "admin" | "member";
export type MemberStatus = "active" | "invited" | "revoked";

export interface MemberRecord {
  id: string;
  userId: string | null;
  invitedEmail: string | null;
  role: MemberRole;
  status: MemberStatus;
}

interface RawMember {
  id: string;
  accountId?: string;
  userId: string | null;
  invitedEmail: string | null;
  role: string;
  status: string;
}

function toRecord(member: RawMember): MemberRecord {
  return {
    id: member.id,
    userId: member.userId,
    invitedEmail: member.invitedEmail,
    role: member.role as MemberRole,
    status: member.status as MemberStatus,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function seatLimit(plan: PlanId): number {
  return limitsFor(plan).teamSeats;
}

// Active member user ids for an account. This is the seam the data-scope
// migration (deferred) will use to widen every seller-scoped query from one
// user to all members of the account.
export async function accountMemberIds(
  accountId: string,
  prisma: Db = getPrisma(),
): Promise<string[]> {
  const members = await prisma.accountMember.findMany({
    where: { accountId, status: "active", userId: { not: null } },
    select: { userId: true },
  });
  return members
    .map((member) => member.userId)
    .filter((id): id is string => Boolean(id));
}

export async function listMembers(
  accountId: string,
  prisma: Db = getPrisma(),
): Promise<MemberRecord[]> {
  const members = await prisma.accountMember.findMany({
    where: { accountId, status: { not: "revoked" } },
    orderBy: { createdAt: "asc" },
  });
  return members.map(toRecord);
}

export async function assertCanManageAccount(
  account: { id: string; ownerUserId: string },
  userId: string,
  prisma: Db = getPrisma(),
): Promise<void> {
  if (account.ownerUserId === userId) return;

  const membership = await prisma.accountMember.findFirst({
    where: { accountId: account.id, userId, status: "active", role: "admin" },
    select: { id: true },
  });
  if (membership) return;

  throw new AppError(
    "Only account owners and admins can manage this account.",
    403,
    "ACCOUNT_MANAGEMENT_FORBIDDEN",
  );
}

// A pending invite OR an active member both consume a seat. Revoked rows do not.
async function seatsUsed(accountId: string, prisma: Db): Promise<number> {
  return prisma.accountMember.count({
    where: { accountId, status: { in: ["active", "invited"] } },
  });
}

export async function inviteMember(
  account: { id: string; plan: PlanId },
  email: string,
  role: MemberRole = "member",
  prisma: Db = getPrisma(),
): Promise<MemberRecord> {
  const invitedEmail = normalizeEmail(email);
  if (!invitedEmail || !invitedEmail.includes("@")) {
    throw new AppError("A valid email is required to invite a member.", 400, "INVALID_INVITE_EMAIL");
  }
  if (role === "owner") {
    throw new AppError("Cannot invite a second owner.", 400, "INVALID_INVITE_ROLE");
  }

  const existing = await prisma.accountMember.findFirst({
    where: {
      accountId: account.id,
      invitedEmail,
      status: { in: ["active", "invited"] },
    },
  });
  if (existing) return toRecord(existing);

  const limit = seatLimit(account.plan);
  if ((await seatsUsed(account.id, prisma)) >= limit) {
    throw new AppError(
      `Your plan includes ${limit} seat${limit === 1 ? "" : "s"}. Upgrade to add more.`,
      403,
      "SEAT_LIMIT_REACHED",
    );
  }

  const member = await prisma.accountMember.create({
    data: { accountId: account.id, invitedEmail, role, status: "invited" },
  });
  return toRecord(member);
}

// Binds a signed-in user to a matching pending invite. Returns null when there
// is no invite for the email (the caller keeps their personal account).
export async function acceptInvite(
  userId: string,
  email: string,
  prisma: Db = getPrisma(),
): Promise<MemberRecord | null> {
  const invitedEmail = normalizeEmail(email);
  const invite = await prisma.accountMember.findFirst({
    where: { invitedEmail, status: "invited" },
    orderBy: { createdAt: "asc" },
  });
  if (!invite) return null;

  if (invite.accountId) {
    const active = await prisma.accountMember.findFirst({
      where: { accountId: invite.accountId, userId, status: "active" },
    });
    if (active) {
      await prisma.accountMember.update({
        where: { id: invite.id },
        data: { status: "revoked", userId: null },
      });
      return toRecord(active);
    }
  }

  const member = await prisma.accountMember.update({
    where: { id: invite.id },
    data: { userId, status: "active" },
  });
  return toRecord(member);
}

export async function revokeMember(
  account: { id: string },
  memberId: string,
  prisma: Db = getPrisma(),
): Promise<void> {
  const member = await prisma.accountMember.findFirst({
    where: { id: memberId, accountId: account.id },
  });
  if (!member) {
    throw new AppError("Member not found.", 404, "MEMBER_NOT_FOUND");
  }
  if (member.role === "owner") {
    throw new AppError("The account owner cannot be removed.", 400, "CANNOT_REMOVE_OWNER");
  }
  // Clear userId so the freed seat can be re-invited without a unique clash.
  await prisma.accountMember.update({
    where: { id: memberId },
    data: { status: "revoked", userId: null },
  });
}
