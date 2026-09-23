import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assertStandingAuthorization, readAutomationSettings, saveAutomationSettings, snapshotAutomation } from "./settings";
import { AutomationSettingsInput } from "./settings-schema";

const revision = "00000000-0000-4000-8000-000000000001";
const policy = { version: 1, enabled: true, revision, authorizedBy: "owner", authorizedAt: "2026-09-22T00:00:00.000Z", minPriceCents: 1000, maxPriceCents: 20000 };
function harness(value: unknown = policy) {
  const account = { ownerUserId: "owner", disabledAt: null as Date | null, automationPolicy: structuredClone(value) };
  const db = { account: { findUnique: vi.fn(async () => account), update: vi.fn(async ({ data }) => { Object.assign(account, data); return account; }) }, jobLog: { findMany: vi.fn(async () => [{ id: "job", inventoryItemId: "item" }]), updateMany: vi.fn(async () => ({ count: 1 })) }, inventoryItem: { findFirst: vi.fn(async () => ({ accountId: "account", sellerId: "owner" })) }, reviewTask: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({ id: "review" })) }, $transaction: vi.fn(), $queryRaw: vi.fn() };
  db.$transaction.mockImplementation(async (fn) => fn(db));
  return { db, account };
}

describe("saved account automatic posting authorization", () => {
  beforeEach(() => vi.clearAllMocks());
  it.each([null, {}, { ...policy, authorizedBy: "former-owner" }])("defaults absent, invalid and transferred policy to disabled", async (value) => {
    const h = harness(value);
    expect(await readAutomationSettings(h.db, "account", "member")).toEqual({ policy: { enabled: false, revision: null }, canManage: false });
    expect(await snapshotAutomation(h.db, "account", new Date())).toEqual({ policy: { mode: "prepare" } });
  });
  it("reads only the resolved account and never exposes authorization identity", async () => {
    const h = harness();
    const result = await readAutomationSettings(h.db, "resolved-account", "owner");
    expect(h.db.account.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "resolved-account" } }));
    expect(result.canManage).toBe(true); expect(JSON.stringify(result)).not.toContain("authorizedBy");
  });
  it.each(["member", "admin", "other-owner"])("rejects %s writes including pause", async (user) => {
    const h = harness(); await expect(saveAutomationSettings(h.db as never, "account", user, { enabled: false, expectedRevision: revision })).rejects.toMatchObject({ code: "AUTOMATION_OWNER_REQUIRED" });
    expect(h.db.account.update).not.toHaveBeenCalled(); expect(h.db.jobLog.updateMany).not.toHaveBeenCalled();
  });
  it("requires explicit consent and valid bounds for enabling", () => {
    for (const input of [{ enabled: true, minPriceCents: 1, maxPriceCents: 2 }, { enabled: true, consent: true, minPriceCents: 10, maxPriceCents: 2 }, { enabled: true, consent: true, minPriceCents: 0, maxPriceCents: 2 }, { enabled: false, accountId: "other" }]) expect(AutomationSettingsInput.safeParse(input).success).toBe(false);
  });
  it("snapshots only new intake and does not authorize existing inventory", async () => {
    const h = harness();
    expect(await snapshotAutomation(h.db, "account", new Date("2026-09-21"))).toEqual({ policy: { mode: "prepare" } });
    expect(await snapshotAutomation(h.db, "account", new Date("2026-09-23"))).toEqual({ policy: { mode: "publish", marketplace: "ebay", consent: true, minPriceCents: 1000, maxPriceCents: 20000 }, standingAuthorization: { revision } });
  });
  it("pauses with a new revision without scanning or blocking on the queue", async () => {
    const h = harness(); const result = await saveAutomationSettings(h.db as never, "account", "owner", { enabled: false, expectedRevision: revision });
    expect(result.policy.enabled).toBe(false); expect(result.policy.revision).not.toBe(revision);
    expect(h.db.jobLog.findMany).not.toHaveBeenCalled();
    expect(h.db.jobLog.updateMany).not.toHaveBeenCalled();
    await expect(assertStandingAuthorization(h.db, "account", { revision })).rejects.toMatchObject({ code: "AUTOMATION_AUTHORIZATION_CHANGED" });
  });
  it("stale settings cannot re-enable after a concurrent pause", async () => {
    const h = harness(); await saveAutomationSettings(h.db as never, "account", "owner", { enabled: false, expectedRevision: revision });
    await expect(saveAutomationSettings(h.db as never, "account", "owner", { enabled: true, consent: true, minPriceCents: 1000, maxPriceCents: 20000, expectedRevision: revision })).rejects.toMatchObject({ code: "AUTOMATION_SETTINGS_CONFLICT" });
    expect(h.db.account.update).toHaveBeenCalledTimes(1);
  });
  it("changed bounds revoke old jobs instead of broadening their consent", async () => {
    const h = harness(); await saveAutomationSettings(h.db as never, "account", "owner", { enabled: true, consent: true, minPriceCents: 1, maxPriceCents: 50000, expectedRevision: revision });
    await expect(assertStandingAuthorization(h.db, "account", { revision })).rejects.toMatchObject({ code: "AUTOMATION_AUTHORIZATION_CHANGED" });
  });
  it("lets a new owner save after a transferred policy is hidden as disabled", async () => {
    const h = harness({ ...policy, authorizedBy: "old-owner" });
    const view = await readAutomationSettings(h.db, "account", "owner");
    expect(view.policy).toEqual({ enabled: false, revision: null });
    const result = await saveAutomationSettings(h.db as never, "account", "owner", { enabled: true, consent: true, minPriceCents: 1000, maxPriceCents: 20000, expectedRevision: view.policy.revision });
    expect(result.policy.enabled).toBe(true);
  });
  it("rejects blind settings edits without a revision", async () => {
    const h = harness();
    await expect(saveAutomationSettings(h.db as never, "account", "owner", { enabled: false })).rejects.toBeDefined();
    expect(h.db.account.update).not.toHaveBeenCalled();
  });
  it("disabled accounts cannot save or authorize", async () => {
    const h = harness(); h.account.disabledAt = new Date();
    await expect(saveAutomationSettings(h.db as never, "account", "owner", { enabled: false, expectedRevision: revision })).rejects.toMatchObject({ status: 403 });
    await expect(assertStandingAuthorization(h.db, "account", { revision })).rejects.toMatchObject({ code: "AUTOMATION_AUTHORIZATION_CHANGED" });
  });
  it("uses an additive nullable migration without changing RLS or authorizing old accounts", () => {
    const sql = readFileSync("prisma/migrations/20260923080000_account_automation_policy/migration.sql", "utf8");
    expect(sql).toContain('ALTER TABLE "Account" ADD COLUMN "automationPolicy" JSONB;');
    expect(sql.replace(/^--.*$/gm, "")).not.toMatch(/DROP|UPDATE|CREATE POLICY|DISABLE ROW LEVEL|DEFAULT/i);
  });
});
