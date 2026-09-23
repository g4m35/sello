import { randomUUID } from "node:crypto";
import type { getPrisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import type { ListingAutomation } from "./policy";
import { AutomationSettingsInput, StoredAutomationPolicy, type AutomationSettings, type StandingAuthorization } from "./settings-schema";

type Db = ReturnType<typeof getPrisma>;
export type PolicyReader = { account: { findUnique(args: {
  where: { id: string }; select: { automationPolicy: true; ownerUserId: true; disabledAt: true };
}): Promise<{ automationPolicy: unknown; ownerUserId: string; disabledAt: Date | null } | null> } };
const select = { automationPolicy: true, ownerUserId: true, disabledAt: true } as const;
const changed = () => new AppError("Automatic posting was paused or its authorization changed. Review this listing.", 409, "AUTOMATION_AUTHORIZATION_CHANGED");

export async function readAutomationSettings(db: PolicyReader, accountId: string, userId: string): Promise<AutomationSettings> {
  const account = await db.account.findUnique({ where: { id: accountId }, select });
  if (!account || account.disabledAt) throw new AppError("Account unavailable.", 403);
  const parsed = StoredAutomationPolicy.safeParse(account.automationPolicy);
  const policy = parsed.success && parsed.data.authorizedBy === account.ownerUserId ? parsed.data : null;
  return { canManage: account.ownerUserId === userId, policy: policy ? {
    enabled: policy.enabled, revision: policy.revision, minPriceCents: policy.minPriceCents, maxPriceCents: policy.maxPriceCents,
  } : { enabled: false, revision: null } };
}

export async function saveAutomationSettings(db: Db, accountId: string, userId: string, raw: unknown): Promise<AutomationSettings> {
  const input = AutomationSettingsInput.parse(raw);
  return db.$transaction(async (tx) => {
    // Serialize settings edits against each other without trusting caller account data.
    await tx.$queryRaw`SELECT "id" FROM "Account" WHERE "id" = ${accountId}::uuid FOR UPDATE`;
    const account = await tx.account.findUnique({ where: { id: accountId }, select });
    if (!account || account.disabledAt || account.ownerUserId !== userId) {
      throw new AppError("Only the account owner can change automatic posting.", 403, "AUTOMATION_OWNER_REQUIRED");
    }
    const stored = StoredAutomationPolicy.safeParse(account.automationPolicy);
    const previous = stored.success && stored.data.authorizedBy === account.ownerUserId ? stored : { success: false as const };
    const revision = previous.success ? previous.data.revision : null;
    if (input.expectedRevision !== revision) {
      throw new AppError("Automation settings changed. Reload them before saving.", 409, "AUTOMATION_SETTINGS_CONFLICT");
    }
    const policy = { version: 1 as const, enabled: input.enabled, revision: randomUUID(), authorizedBy: userId,
      authorizedAt: new Date().toISOString(),
      minPriceCents: input.enabled ? input.minPriceCents : previous.success ? previous.data.minPriceCents : 1,
      maxPriceCents: input.enabled ? input.maxPriceCents : previous.success ? previous.data.maxPriceCents : 10_000_000 };
    await tx.account.update({ where: { id: accountId }, data: { automationPolicy: policy } });
    // Revision invalidates queued/running work immediately. The worker creates
    // its normal attention task at the next check; never scan an unbounded queue
    // while holding this lock, because a large backlog must not prevent pausing.
    return { canManage: true, policy: { enabled: policy.enabled, revision: policy.revision, minPriceCents: policy.minPriceCents, maxPriceCents: policy.maxPriceCents } };
  });
}

export async function snapshotAutomation(db: PolicyReader, accountId: string, createdAt: Date): Promise<{
  policy: ListingAutomation; standingAuthorization?: StandingAuthorization;
}> {
  const account = await db.account.findUnique({ where: { id: accountId }, select });
  const parsed = StoredAutomationPolicy.safeParse(account?.automationPolicy);
  if (!account || account.disabledAt || !parsed.success || !parsed.data.enabled || parsed.data.authorizedBy !== account.ownerUserId ||
      new Date(parsed.data.authorizedAt).getTime() > createdAt.getTime()) return { policy: { mode: "prepare" } };
  return { policy: { mode: "publish", marketplace: "ebay", consent: true, minPriceCents: parsed.data.minPriceCents, maxPriceCents: parsed.data.maxPriceCents },
    standingAuthorization: { revision: parsed.data.revision } };
}

export async function assertStandingAuthorization(db: PolicyReader, accountId: string, reference: StandingAuthorization) {
  const account = await db.account.findUnique({ where: { id: accountId }, select });
  const parsed = StoredAutomationPolicy.safeParse(account?.automationPolicy);
  if (!account || account.disabledAt || !parsed.success || !parsed.data.enabled || parsed.data.revision !== reference.revision || parsed.data.authorizedBy !== account.ownerUserId) throw changed();
}
