import { Queue } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";

import { MarketplaceSchema } from "@/lib/ai/listing-draft";
import { getRequiredEnv } from "@/lib/errors";

export const PublishListingJobSchema = z
  .object({
    inventoryItemId: z.string().uuid(),
    listingDraftId: z.string().uuid(),
    marketplaces: z.array(MarketplaceSchema).min(1).max(4),
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

function getRedisConnection() {
  connection ??= new IORedis(getRequiredEnv("REDIS_URL"), {
    maxRetriesPerRequest: null,
  });

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
