import { z } from "zod";

import { ConditionSchema } from "../ai/listing-draft";

export const PriceCompInputSchema = z
  .object({
    source: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(200),
    priceCents: z.number().int().positive(),
    shippingCents: z.number().int().min(0).default(0),
    soldDate: z.coerce.date().nullable().optional(),
    url: z.string().trim().url().max(500).nullable().optional(),
    condition: ConditionSchema.default("unknown"),
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
