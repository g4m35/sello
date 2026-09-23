import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), access: vi.fn(), enqueue: vi.fn(), run: vi.fn(), after: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (original) => ({ ...await original<typeof import("next/server")>(), after: mocks.after }));
vi.mock("@/lib/prisma", () => ({ getPrisma: () => ({}) }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.user }));
vi.mock("@/lib/auth/feature-access", () => ({ resolveRuntimeEntitlements: mocks.access }));
vi.mock("@/lib/bulk-intake/jobs", () => ({ enqueueBulkGeneration: mocks.enqueue, runBulkGenerationJob: mocks.run }));
import { POST } from "./route";
const photoId = "30000000-0000-4000-8000-000000000001";
function request(body: unknown) { return new Request("https://sello.test/api/bulk/batches/batch-1/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "user-1" });
  mocks.access.mockResolvedValue({ account: { id: "account-1", plan: "free" }, plan: "seller" });
  mocks.enqueue.mockResolvedValue({ jobIds: ["job-1", "job-2"], batch: { id: "batch-1" }, itemIds: [] });
});
describe("bulk start route", () => {
  it("persists current groups then responds before running one background job", async () => {
    const groups = [{ photoIds: [photoId] }];
    const response = await POST(request({ groups }), { params: Promise.resolve({ batchId: "batch-1" }) });
    expect(response.status).toBe(202);
    expect(mocks.enqueue).toHaveBeenCalledWith({ batchId: "batch-1", groups, user: { id: "user-1" }, account: { id: "account-1", plan: "seller" } }, {});
    expect(mocks.run).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0]![0]();
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith("job-1", {});
  });
  it("rejects invalid groups without persisting or scheduling work", async () => {
    const response = await POST(request({ groups: [{ photoIds: [] }] }), { params: Promise.resolve({ batchId: "batch-1" }) });
    expect(response.status).toBe(400);
    expect(mocks.enqueue).not.toHaveBeenCalled(); expect(mocks.after).not.toHaveBeenCalled();
  });
  it("does not schedule when the durable write fails", async () => {
    mocks.enqueue.mockRejectedValue(new Error("database failure"));
    const response = await POST(request({}), { params: Promise.resolve({ batchId: "batch-1" }) });
    expect(response.status).toBe(500); expect(mocks.after).not.toHaveBeenCalled();
  });
});
