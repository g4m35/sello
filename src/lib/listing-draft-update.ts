import { z } from "zod";

import { MarketplaceSchema } from "./ai/listing-draft";
import { countMeaningfulBullets, READINESS_THRESHOLDS } from "./lifecycle/readiness";

const EbayMarketplaceDraftUpdateSchema = z
  .object({
    categoryId: z
      .string()
      .trim()
      .regex(/^\d*$/, "eBay category ID must contain digits only.")
      .max(32),
  })
  .strict();

export const ListingDraftUpdateSchema = z
  .object({
    title: z.string().max(80),
    description: z.string().max(3000),
    bulletPoints: z.array(z.string().max(160)).max(8),
    recommendedPriceCents: z.number().int().positive().nullable(),
    marketplaceDrafts: z
      .object({
        ebay: EbayMarketplaceDraftUpdateSchema.optional(),
      })
      .strict()
      .optional(),
    selectedMarketplaces: z.array(MarketplaceSchema).max(4),
    approve: z.boolean().optional().default(false),
  })
  .strict()
  .superRefine((update, context) => {
    if (!update.approve) {
      return;
    }

    if (update.title.trim().length < READINESS_THRESHOLDS.titleMinLength) {
      context.addIssue({
        code: "custom",
        message: `Title must be at least ${READINESS_THRESHOLDS.titleMinLength} characters before approval.`,
        path: ["title"],
      });
    }

    if (update.description.trim().length < READINESS_THRESHOLDS.descriptionMinLength) {
      context.addIssue({
        code: "custom",
        message: `Description must be at least ${READINESS_THRESHOLDS.descriptionMinLength} characters before approval.`,
        path: ["description"],
      });
    }

    if (countMeaningfulBullets(update.bulletPoints) < READINESS_THRESHOLDS.minBulletPoints) {
      context.addIssue({
        code: "custom",
        message: `Add at least ${READINESS_THRESHOLDS.minBulletPoints} bullet points before approval.`,
        path: ["bulletPoints"],
      });
    }

    if (update.selectedMarketplaces.length < READINESS_THRESHOLDS.minMarketplaces) {
      context.addIssue({
        code: "custom",
        message: "Select at least one marketplace before approval.",
        path: ["selectedMarketplaces"],
      });
    }
  });

export type ListingDraftUpdate = z.infer<typeof ListingDraftUpdateSchema>;
