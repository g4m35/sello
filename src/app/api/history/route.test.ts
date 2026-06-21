import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPrisma: vi.fn(),
  requireSupabaseUser: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({ getPrisma: mocks.getPrisma }));
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: mocks.requireSupabaseUser }));

import { AppError } from "@/lib/errors";

import { GET } from "./route";

const req = () => new Request("http://localhost/api/history");

// Representative coverage for the route error-sanitization sweep: the same
// safeClientMessage wiring is applied identically across the swept routes.
describe("GET /api/history error sanitization", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("returns the safe author message for an AppError (401)", async () => {
    mocks.requireSupabaseUser.mockRejectedValue(new AppError("Sign in.", 401));
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign in." });
  });

  it("never leaks a raw DB error from the catch block", async () => {
    mocks.requireSupabaseUser.mockResolvedValue({ id: "user-1" });
    const raw = new Error(
      "PrismaClientKnownRequestError: can't reach db 1.2.3.4 token=secret-xyz",
    );
    raw.name = "PrismaClientKnownRequestError";
    mocks.getPrisma.mockReturnValue({
      publishAttempt: { findMany: vi.fn().mockRejectedValue(raw) },
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(req());
    const body = await res.text();

    expect(res.status).toBe(500);
    expect(JSON.parse(body).error).toBe("Something went wrong on our end. Please try again.");
    expect(body).not.toContain("Prisma");
    expect(body).not.toContain("token=secret");
    expect(body).not.toContain("1.2.3.4");
    // The raw message is not echoed into logs either (class + code only).
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("token=secret");
    consoleError.mockRestore();
  });
});
