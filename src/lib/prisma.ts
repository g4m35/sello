import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

import { getRequiredEnv } from "./errors";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

const DEFAULT_POOL_MAX = 5;

export function resolveDatabasePoolMax(
  databaseUrl: string,
  env: Record<string, string | undefined> = process.env,
): number {
  const configured = env.DATABASE_POOL_MAX?.trim();
  let candidate = configured;
  if (!candidate) {
    try {
      candidate = new URL(databaseUrl).searchParams.get("connection_limit") ?? undefined;
    } catch {
      // Prisma reports invalid database URLs without exposing them. Pool sizing
      // falls back safely rather than trying to log or repair credentials here.
    }
  }
  if (!candidate) return DEFAULT_POOL_MAX;
  const value = Number(candidate);
  return Number.isInteger(value) && value >= 1 && value <= 20
    ? value
    : DEFAULT_POOL_MAX;
}

export function getPrisma() {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  const databaseUrl = getRequiredEnv("DATABASE_URL");
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    max: resolveDatabasePoolMax(databaseUrl),
  });
  const prisma = new PrismaClient({ adapter });

  // A warm serverless runtime can handle many requests. Reusing one client per
  // runtime prevents each request from creating another adapter-owned pg pool.
  globalForPrisma.prisma = prisma;

  return prisma;
}
