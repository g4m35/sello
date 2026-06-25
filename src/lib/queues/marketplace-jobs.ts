import { Queue } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";

import { MarketplaceSchema } from "@/lib/ai/listing-draft";
import { isPublishQueueEligible } from "@/lib/marketplace/registry";
import { getRequiredEnv } from "@/lib/errors";

// Fail closed at the enqueue boundary: only channels with a real publish path
// (full-native or assisted/copy-ready) may be queued. Gated scaffolds (Vinted)
// and catalog-match scaffolds (StockX) are rejected here so they can never be
// enqueued for autonomous publishing, even though they are valid enum values.
const PublishableMarketplaceSchema = MarketplaceSchema.refine(
  isPublishQueueEligible,
  { message: "Marketplace is not eligible for autonomous publishing" },
);

export const PublishListingJobSchema = z
  .object({
    inventoryItemId: z.string().uuid(),
    listingDraftId: z.string().uuid(),
    marketplaces: z.array(PublishableMarketplaceSchema).min(1).max(6),
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
