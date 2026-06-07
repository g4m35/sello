import { z } from "zod";

// Item-level identification fields (live on InventoryItem, not the draft).
export const ITEM_CATEGORIES = [
  "sneakers",
  "streetwear",
  "hype_fashion",
  "accessories",
  "other",
] as const;

export const ITEM_CONDITIONS = [
  "new_with_tags",
  "new_without_tags",
  "used_excellent",
  "used_good",
  "used_fair",
  "for_parts",
  "unknown",
] as const;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v));

export const ItemUpdateSchema = z
  .object({
    productName: z.string().trim().min(1).max(160).optional(),
    brand: optionalText(120),
    category: z.enum(ITEM_CATEGORIES).optional(),
    condition: z.enum(ITEM_CONDITIONS).optional(),
    size: optionalText(60),
    colorway: optionalText(80),
    styleCode: optionalText(120),
  })
  .strict();

export type ItemUpdate = z.infer<typeof ItemUpdateSchema>;
