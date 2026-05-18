import { Type } from "@google/genai";
import { z } from "zod";

export const MarketplaceSchema = z.enum(["ebay", "grailed", "poshmark", "depop"]);

export const ConditionSchema = z.enum([
  "new_with_tags",
  "new_without_tags",
  "used_excellent",
  "used_good",
  "used_fair",
  "for_parts",
  "unknown",
]);

export const ProductCategorySchema = z.enum([
  "sneakers",
  "streetwear",
  "hype_fashion",
  "accessories",
  "other",
]);

const MarketplaceListingSchema = z
  .object({
    title: z.string().min(10).max(80),
    description: z.string().min(20).max(2000),
    categoryHint: z.string().min(2).max(80),
    tags: z.array(z.string().min(1).max(40)).min(1).max(12),
  })
  .strict();

export const GeminiListingDraftSchema = z
  .object({
    identification: z
      .object({
        productName: z.string().min(2).max(160),
        brand: z.string().min(1).max(80),
        category: ProductCategorySchema,
        styleCode: z.string().min(1).max(80).nullable(),
        colorway: z.string().min(1).max(120).nullable(),
        size: z.string().min(1).max(80).nullable(),
        condition: ConditionSchema,
        confidence: z.number().min(0).max(1),
        identifiers: z.array(z.string().min(1).max(120)).max(12),
        authenticationNotes: z.array(z.string().min(1).max(240)).max(8),
      })
      .strict(),
    listingDraft: z
      .object({
        title: z.string().min(10).max(80),
        description: z.string().min(40).max(3000),
        bulletPoints: z.array(z.string().min(1).max(160)).min(3).max(8),
        itemSpecifics: z.record(z.string().min(1), z.string().min(1).max(160)),
        recommendedPriceCents: z.number().int().positive().nullable(),
        pricingRationale: z.string().min(10).max(600),
        compSearchQueries: z.array(z.string().min(8).max(180)).min(1).max(6),
      })
      .strict(),
    marketplaceDrafts: z
      .object({
        ebay: MarketplaceListingSchema,
        grailed: MarketplaceListingSchema,
        poshmark: MarketplaceListingSchema,
        depop: MarketplaceListingSchema,
      })
      .strict(),
    warnings: z.array(z.string().min(1).max(240)).max(8),
  })
  .strict();

export type GeminiListingDraft = z.infer<typeof GeminiListingDraftSchema>;
export type Marketplace = z.infer<typeof MarketplaceSchema>;

export function parseGeminiListingDraft(rawText: string): GeminiListingDraft {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Gemini returned non-JSON content.");
  }

  const result = GeminiListingDraftSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(`Gemini JSON failed validation: ${result.error.message}`);
  }

  return result.data;
}

const marketplaceDraftJsonSchema = {
  type: Type.OBJECT,
  properties: {
    title: { type: Type.STRING },
    description: { type: Type.STRING },
    categoryHint: { type: Type.STRING },
    tags: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["title", "description", "categoryHint", "tags"],
};

export const geminiListingDraftResponseSchema = {
  type: Type.OBJECT,
  properties: {
    identification: {
      type: Type.OBJECT,
      properties: {
        productName: { type: Type.STRING },
        brand: { type: Type.STRING },
        category: {
          type: Type.STRING,
          format: "enum",
          enum: ProductCategorySchema.options,
        },
        styleCode: { type: Type.STRING, nullable: true },
        colorway: { type: Type.STRING, nullable: true },
        size: { type: Type.STRING, nullable: true },
        condition: {
          type: Type.STRING,
          format: "enum",
          enum: ConditionSchema.options,
        },
        confidence: { type: Type.NUMBER },
        identifiers: { type: Type.ARRAY, items: { type: Type.STRING } },
        authenticationNotes: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: [
        "productName",
        "brand",
        "category",
        "styleCode",
        "colorway",
        "size",
        "condition",
        "confidence",
        "identifiers",
        "authenticationNotes",
      ],
    },
    listingDraft: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        description: { type: Type.STRING },
        bulletPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
        itemSpecifics: {
          type: Type.OBJECT,
          additionalProperties: { type: Type.STRING },
        },
        recommendedPriceCents: { type: Type.INTEGER, nullable: true },
        pricingRationale: { type: Type.STRING },
        compSearchQueries: { type: Type.ARRAY, items: { type: Type.STRING } },
      },
      required: [
        "title",
        "description",
        "bulletPoints",
        "itemSpecifics",
        "recommendedPriceCents",
        "pricingRationale",
        "compSearchQueries",
      ],
    },
    marketplaceDrafts: {
      type: Type.OBJECT,
      properties: {
        ebay: marketplaceDraftJsonSchema,
        grailed: marketplaceDraftJsonSchema,
        poshmark: marketplaceDraftJsonSchema,
        depop: marketplaceDraftJsonSchema,
      },
      required: ["ebay", "grailed", "poshmark", "depop"],
    },
    warnings: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["identification", "listingDraft", "marketplaceDrafts", "warnings"],
};
