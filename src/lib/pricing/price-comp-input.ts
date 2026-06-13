import { z } from "zod";

import { ConditionSchema } from "../ai/listing-draft";

// Comp URLs are rendered as clickable links, so only allow http(s) to keep a
// stored `javascript:`/`data:` URL from becoming a script-execution vector.
function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export const CompSourceTypeSchema = z.enum(["manual", "api", "scraper", "visual_search"]);
export const CompStatusSchema = z.enum(["sold", "active", "unknown"]);

const httpUrl = z
  .string()
  .trim()
  .url()
  .max(500)
  .refine(isHttpUrl, "URL must use http or https.");

export const PriceCompInputSchema = z
  .object({
    source: z.string().trim().min(1).max(80),
    sourceType: CompSourceTypeSchema.default("manual"),
    platform: z.string().trim().max(60).nullable().optional(),
    status: CompStatusSchema.default("unknown"),
    title: z.string().trim().min(1).max(200),
    brand: z.string().trim().max(80).nullable().optional(),
    size: z.string().trim().max(40).nullable().optional(),
    priceCents: z.number().int().positive(),
    shippingCents: z.number().int().min(0).default(0),
    totalPriceCents: z.number().int().positive().nullable().optional(),
    currency: z.string().trim().length(3).default("USD"),
    soldDate: z.coerce.date().nullable().optional(),
    url: httpUrl.nullable().optional(),
    imageUrl: httpUrl.nullable().optional(),
    condition: ConditionSchema.default("unknown"),
    matchScore: z.number().min(0).max(1).nullable().optional(),
    usedInPricing: z.boolean().default(true),
    ignoredAsOutlier: z.boolean().default(false),
    rawJson: z.unknown().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict();

export type PriceCompInput = z.infer<typeof PriceCompInputSchema>;

export const CreatePriceCompRequestSchema = z
  .object({
    inventoryItemId: z.uuid(),
    comp: PriceCompInputSchema,
  })
  .strict();

export type CreatePriceCompRequest = z.infer<typeof CreatePriceCompRequestSchema>;

// Every field optional; at least one required. Used by PATCH /comps/[compId].
export const UpdatePriceCompSchema = z
  .object({
    source: z.string().trim().min(1).max(80).optional(),
    sourceType: CompSourceTypeSchema.optional(),
    platform: z.string().trim().max(60).nullable().optional(),
    status: CompStatusSchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    brand: z.string().trim().max(80).nullable().optional(),
    size: z.string().trim().max(40).nullable().optional(),
    priceCents: z.number().int().positive().optional(),
    shippingCents: z.number().int().min(0).optional(),
    totalPriceCents: z.number().int().positive().nullable().optional(),
    currency: z.string().trim().length(3).optional(),
    soldDate: z.coerce.date().nullable().optional(),
    url: httpUrl.nullable().optional(),
    imageUrl: httpUrl.nullable().optional(),
    condition: ConditionSchema.optional(),
    matchScore: z.number().min(0).max(1).nullable().optional(),
    usedInPricing: z.boolean().optional(),
    ignoredAsOutlier: z.boolean().optional(),
    rawJson: z.unknown().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .strict()
  .refine((obj) => Object.keys(obj).length > 0, { message: "No fields to update." });

export type UpdatePriceCompInput = z.infer<typeof UpdatePriceCompSchema>;
