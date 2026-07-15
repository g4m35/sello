import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

import { getRequiredEnv } from "./errors";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

export function getPrisma() {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  const adapter = new PrismaPg(getRequiredEnv("DATABASE_URL"));
  const prisma = new PrismaClient({ adapter });

  // A warm serverless runtime can handle many requests. Reusing one client per
  // runtime prevents each request from creating another adapter-owned pg pool.
  globalForPrisma.prisma = prisma;

  return prisma;
}
