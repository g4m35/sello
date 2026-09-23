import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), account: vi.fn(), get: vi.fn(), save: vi.fn(), db: {} }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.user }));
vi.mock("@/lib/billing/account", () => ({ getActiveAccount: mocks.account }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => mocks.db }));
vi.mock("@/lib/automation/settings", () => ({ readAutomationSettings: mocks.get, saveAutomationSettings: mocks.save }));
import { AppError } from "@/lib/errors";
import { GET, PUT } from "./route";

describe("automatic posting settings API", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "user" }); mocks.account.mockResolvedValue({ id: "active-account" });
    mocks.get.mockResolvedValue({ policy: { enabled: false, revision: null }, canManage: false }); mocks.save.mockResolvedValue({ policy: { enabled: false, revision: "revision" }, canManage: true });
  });
  it("reads resolved account regardless of user-supplied query and does not cache", async () => {
    const response = await GET(new Request("https://sello.test/api/automation/settings?accountId=other"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.get).toHaveBeenCalledWith(mocks.db, "active-account", "user");
  });
  it("passes only validated settings and resolved user/account to ownership enforcement", async () => {
    const response = await PUT(new Request("https://sello.test/api/automation/settings", { method: "PUT", body: JSON.stringify({ enabled: false, expectedRevision: null }) }));
    expect(response.status).toBe(200); expect(mocks.save).toHaveBeenCalledWith(mocks.db, "active-account", "user", { enabled: false, expectedRevision: null });
  });
  it.each([{ enabled: false, accountId: "other" }, { enabled: true, minPriceCents: 100, maxPriceCents: 200 }])("rejects account injection or missing consent", async (body) => {
    const response = await PUT(new Request("https://sello.test/api/automation/settings", { method: "PUT", body: JSON.stringify(body) }));
    expect(response.status).toBe(400); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON as client error", async () => {
    const response = await PUT(new Request("https://sello.test/api/automation/settings", { method: "PUT", body: "{" })); expect(response.status).toBe(400);
  });
  it.each([GET, PUT])("requires authentication", async (method) => {
    mocks.user.mockRejectedValue(new AppError("Sign in.", 401)); const response = await method(new Request("https://sello.test/api/automation/settings"));
    expect(response.status).toBe(401); expect(mocks.get).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("returns owner-only errors without exposing database details", async () => {
    mocks.save.mockRejectedValue(new AppError("Only the account owner can change automatic posting.", 403, "AUTOMATION_OWNER_REQUIRED"));
    const response = await PUT(new Request("https://sello.test/api/automation/settings", { method: "PUT", body: JSON.stringify({ enabled: false, expectedRevision: null }) })); expect(response.status).toBe(403);
  });
});
