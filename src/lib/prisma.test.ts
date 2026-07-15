import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  PrismaPg: vi.fn(),
  PrismaClient: vi.fn(),
  getRequiredEnv: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: mocks.PrismaPg }));
vi.mock("@/generated/prisma/client", () => ({ PrismaClient: mocks.PrismaClient }));
vi.mock("./errors", () => ({ getRequiredEnv: mocks.getRequiredEnv }));

const globalCache = globalThis as typeof globalThis & { prisma?: unknown };

describe("getPrisma", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    delete globalCache.prisma;
    mocks.getRequiredEnv.mockReturnValue("postgresql://example.invalid/sello");
    mocks.PrismaPg.mockImplementation(function PrismaPgMock() {
      return { adapter: true };
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete globalCache.prisma;
  });

  it("reuses one client and adapter pool in a warm production runtime", async () => {
    const client = { client: true };
    mocks.PrismaClient.mockImplementation(function PrismaClientMock() {
      return client;
    });
    const { getPrisma } = await import("./prisma");

    expect(getPrisma()).toBe(client);
    expect(getPrisma()).toBe(client);
    expect(mocks.PrismaPg).toHaveBeenCalledTimes(1);
    expect(mocks.PrismaClient).toHaveBeenCalledTimes(1);
  });
});
