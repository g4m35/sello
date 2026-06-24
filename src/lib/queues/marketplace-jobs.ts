import { Queue } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";

import { MarketplaceSchema } from "@/lib/ai/listing-draft";
import { getRequiredEnv } from "@/lib/errors";

export const PublishListingJobSchema = z
  .object({
    inventoryItemId: z.string().uuid(),
    listingDraftId: z.string().uuid(),
    marketplaces: z.array(MarketplaceSchema).min(1).max(5),
  })
  .strict();

export const InventorySyncJobSchema = z
  .object({
    inventoryItemId: z.string().uuid(),
    soldMarketplace: MarketplaceSchema,
    soldExternalListingId: z.string().min(1),
  })
  .strict();

export type PublishListingJob = z.infer<typeof PublishListingJobSchema>;
export type InventorySyncJob = z.infer<typeof InventorySyncJobSchema>;

let connection: IORedis | null = null;

function buildRedisConnectionOptions(redisUrl: string) {
  const url = new URL(redisUrl);

  return {
    maxRetriesPerRequest: null,
    connectTimeout: 5_000,
    commandTimeout: 5_000,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
}

function getRedisConnection() {
  const redisUrl = getRequiredEnv("REDIS_URL");
  connection ??= new IORedis(redisUrl, buildRedisConnectionOptions(redisUrl));

  return connection;
}

export function getMarketplacePublishQueue() {
  return new Queue<PublishListingJob>("marketplace-publish", {
    connection: getRedisConnection(),
  });
}

export function getInventorySyncQueue() {
  return new Queue<InventorySyncJob>("inventory-sync", {
    connection: getRedisConnection(),
  });
}
