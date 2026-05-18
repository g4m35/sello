import { z } from "zod";

import { MarketplaceSchema } from "./ai/listing-draft";

export const ListingDraftUpdateSchema = z
  .object({
    title: z.string().max(80),
    description: z.string().max(3000),
    bulletPoints: z.array(z.string().max(160)).max(8),
    recommendedPriceCents: z.number().int().positive().nullable(),
    selectedMarketplaces: z.array(MarketplaceSchema).max(4),
    approve: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((update, context) => {
    if (!update.approve) {
      return;
    }

    if (update.title.trim().length < 10) {
      context.addIssue({
        code: "custom",
        message: "Title must be at least 10 characters before approval.",
        path: ["title"],
      });
    }

    if (update.description.trim().length < 20) {
      context.addIssue({
        code: "custom",
        message: "Description must be at least 20 characters before approval.",
        path: ["description"],
      });
    }

    if (update.bulletPoints.filter((point) => point.trim()).length < 3) {
      context.addIssue({
        code: "custom",
        message: "Add at least 3 bullet points before approval.",
        path: ["bulletPoints"],
      });
    }

    if (update.selectedMarketplaces.length < 1) {
      context.addIssue({
        code: "custom",
        message: "Select at least one marketplace before approval.",
        path: ["selectedMarketplaces"],
      });
    }
  });

export type ListingDraftUpdate = z.infer<typeof ListingDraftUpdateSchema>;
