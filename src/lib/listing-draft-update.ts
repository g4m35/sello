import { z } from "zod";

import { MarketplaceSchema } from "./ai/listing-draft";

export const ListingDraftUpdateSchema = z
  .object({
    title: z.string().min(10).max(80),
    description: z.string().min(20).max(3000),
    bulletPoints: z.array(z.string().min(1).max(160)).min(3).max(8),
    recommendedPriceCents: z.number().int().positive().nullable(),
    selectedMarketplaces: z.array(MarketplaceSchema).min(1).max(4),
    approve: z.boolean().optional().default(false),
  })
  .strict();

export type ListingDraftUpdate = z.infer<typeof ListingDraftUpdateSchema>;
