import { z } from "zod";

import { MarketplaceSchema } from "@/lib/ai/listing-draft";

export const PublishRequestSchema = z
  .object({
    inventoryItemId: z.uuid(),
    marketplace: MarketplaceSchema,
    confirmLivePublish: z.literal(true).optional(),
  })
  .strict();

export type PublishRequest = z.infer<typeof PublishRequestSchema>;
