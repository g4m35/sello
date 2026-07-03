import { Queue } from "bullmq";
import IORedis from "ioredis";
import { z } from "zod";

import { MarketplaceSchema } from "@/lib/ai/listing-draft";
import { isPublishQueueEligible } from "@/lib/marketplace/registry";
import { getRequiredEnv } from "@/lib/errors";

// Fail closed at the enqueue boundary: the background queue accepts only
// channels whose required approval state is represented in the job payload.
const PublishableMarketplaceSchema = MarketplaceSchema.refine(
  isPublishQueueEligible,
  { message: "Marketplace is not eligible for autonomous publishing" },
);

export const PublishListingJobSchema = z
  .object({
    inventoryItemId: z.string().uuid(),
    listingDraftId: z.string().uuid(),
    marketplaces: z.array(PublishableMarketplaceSchema).min(1).max(6),
    confirmLivePublish: z.literal(true).optional(),
  })
  .strict()
  .refine(
    (payload) =>
      !payload.marketplaces.includes("stockx") ||
      payload.confirmLivePublish === true,
    {
      message: "StockX publish jobs require explicit live publish confirmation",
      path: ["confirmLivePublish"],
    },
  );

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
