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
    expect(mocks.PrismaPg).toHaveBeenCalledWith({
      connectionString: "postgresql://example.invalid/sello",
      max: 5,
    });
    expect(mocks.PrismaPg).toHaveBeenCalledTimes(1);
    expect(mocks.PrismaClient).toHaveBeenCalledTimes(1);
  });

  it("honors an explicit pool cap without creating another client", async () => {
    vi.stubEnv("DATABASE_POOL_MAX", "2");
    mocks.PrismaClient.mockImplementation(function PrismaClientMock() {
      return { client: true };
    });
    const { getPrisma } = await import("./prisma");

    getPrisma();
    expect(mocks.PrismaPg).toHaveBeenCalledWith({
      connectionString: "postgresql://example.invalid/sello",
      max: 2,
    });
  });

  it("uses a bounded connection_limit query parameter and rejects unsafe values", async () => {
    const { resolveDatabasePoolMax } = await import("./prisma");

    expect(resolveDatabasePoolMax("postgresql://db/sello?connection_limit=1", {})).toBe(1);
    expect(resolveDatabasePoolMax("postgresql://db/sello?connection_limit=500", {})).toBe(5);
    expect(resolveDatabasePoolMax("not-a-url", { DATABASE_POOL_MAX: "nope" })).toBe(5);
  });
});
