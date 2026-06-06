import { z } from "zod";

// CSV bulk import maps each row to a real DRAFT item. Nothing is published and
// no prices are invented — values come straight from the seller's CSV.

const CONDITIONS = [
  "new_with_tags",
  "new_without_tags",
  "used_excellent",
  "used_good",
  "used_fair",
  "for_parts",
  "unknown",
] as const;

const CATEGORIES = [
  "sneakers",
  "streetwear",
  "hype_fashion",
  "accessories",
  "other",
] as const;

export type ImportCondition = (typeof CONDITIONS)[number];
export type ImportCategory = (typeof CATEGORIES)[number];

// Loose, case-insensitive condition mapping for human-entered CSV values.
export function normalizeCondition(raw: string | undefined | null): ImportCondition {
  if (!raw) return "unknown";
  const v = raw.toLowerCase().trim();
  if ((CONDITIONS as readonly string[]).includes(v)) return v as ImportCondition;
  if (v.includes("excellent") || v.includes("like new")) return "used_excellent";
  if (v.includes("new") && v.includes("without")) return "new_without_tags";
  if (v.includes("tag") && (v.includes("new") || v.includes("nwt"))) return "new_with_tags";
  if (v.includes("new")) return "new_with_tags";
  if (v.includes("good")) return "used_good";
  if (v.includes("fair")) return "used_fair";
  if (v.includes("part")) return "for_parts";
  return "unknown";
}

export function normalizeCategory(raw: string | undefined | null): ImportCategory {
  if (!raw) return "other";
  const v = raw.toLowerCase().trim();
  if ((CATEGORIES as readonly string[]).includes(v)) return v as ImportCategory;
  if (v.includes("sneaker") || v.includes("shoe")) return "sneakers";
  if (v.includes("street")) return "streetwear";
  if (v.includes("hype") || v.includes("fashion")) return "hype_fashion";
  if (v.includes("access") || v.includes("bag") || v.includes("hat")) return "accessories";
  return "other";
}

export const ImportRowSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(160),
  brand: z.string().trim().max(120).optional().nullable(),
  size: z.string().trim().max(60).optional().nullable(),
  color: z.string().trim().max(80).optional().nullable(),
  condition: z.string().trim().max(60).optional().nullable(),
  category: z.string().trim().max(60).optional().nullable(),
  sku: z.string().trim().max(120).optional().nullable(),
  priceCents: z.number().int().positive().max(100_000_00).optional().nullable(),
});

export const ImportRequestSchema = z.object({
  rows: z.array(ImportRowSchema).min(1).max(500),
});

export type ImportRow = z.infer<typeof ImportRowSchema>;
export type ImportRequest = z.infer<typeof ImportRequestSchema>;

export const IMPORT_TARGET_FIELDS = [
  { key: "title", label: "Title", required: true },
  { key: "brand", label: "Brand", required: false },
  { key: "size", label: "Size", required: false },
  { key: "condition", label: "Condition", required: false },
  { key: "color", label: "Color", required: false },
  { key: "price", label: "Price", required: false },
  { key: "sku", label: "SKU", required: false },
] as const;
