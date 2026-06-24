import { Type } from "@google/genai";
import { z } from "zod";

export const MarketplaceSchema = z.enum([
  "ebay",
  "grailed",
  "poshmark",
  "depop",
  "etsy",
]);

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

export const MeasurementUnitSchema = z.enum(["in", "cm", "unknown"]);
export const FlawSeveritySchema = z.enum(["minor", "moderate", "major", "unknown"]);
const FieldSourceSchema = z.enum(["ai", "seller"]);
const SHORT_AI_TEXT_MAX_LENGTH = 240;

const shortAiTextSchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.length > SHORT_AI_TEXT_MAX_LENGTH
      ? value.slice(0, SHORT_AI_TEXT_MAX_LENGTH)
      : value,
  z.string().min(1).max(SHORT_AI_TEXT_MAX_LENGTH),
);

// Structured measurements/flaws. `value: null` means "seller still needs to
// measure"; Gemini must never invent exact numbers from photos.
export const MeasurementSchema = z
  .object({
    label: z.string().min(1).max(80),
    value: z.string().min(1).max(40).nullable(),
    unit: MeasurementUnitSchema,
    confidence: z.number().min(0).max(1).optional(),
    source: FieldSourceSchema.optional(),
  })
  .strict();

export const FlawSchema = z
  .object({
    label: z.string().min(1).max(80),
    description: z.string().min(1).max(400),
    severity: FlawSeveritySchema.optional(),
    confidence: z.number().min(0).max(1).optional(),
    source: FieldSourceSchema.optional(),
  })
  .strict();

export type Measurement = z.infer<typeof MeasurementSchema>;
export type Flaw = z.infer<typeof FlawSchema>;

// Lenient readers for stored draft JSON columns: older drafts have no
// measurements/flaws, and malformed data degrades to "none" rather than 500s.
export function parseMeasurements(value: unknown): Measurement[] {
  const parsed = z.array(MeasurementSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function parseFlaws(value: unknown): Flaw[] {
  const parsed = z.array(FlawSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

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
        authenticationNotes: z.array(shortAiTextSchema).max(8),
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
        // Defaulted so drafts stored before these fields existed still parse.
        measurements: z.array(MeasurementSchema).max(12).default([]),
        flaws: z.array(FlawSchema).max(12).default([]),
      })
      .strict(),
    marketplaceDrafts: z
      .object({
        ebay: MarketplaceListingSchema,
        grailed: MarketplaceListingSchema,
        poshmark: MarketplaceListingSchema,
        depop: MarketplaceListingSchema,
        etsy: MarketplaceListingSchema,
      })
      .strict(),
    warnings: z.array(shortAiTextSchema).max(8),
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

const shortAiTextJsonSchema = {
  type: Type.STRING,
  minLength: "1",
  maxLength: String(SHORT_AI_TEXT_MAX_LENGTH),
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
        authenticationNotes: { type: Type.ARRAY, items: shortAiTextJsonSchema },
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
        measurements: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              value: { type: Type.STRING, nullable: true },
              unit: {
                type: Type.STRING,
                format: "enum",
                enum: MeasurementUnitSchema.options,
              },
              confidence: { type: Type.NUMBER },
            },
            required: ["label", "value", "unit"],
          },
        },
        flaws: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              label: { type: Type.STRING },
              description: { type: Type.STRING },
              severity: {
                type: Type.STRING,
                format: "enum",
                enum: FlawSeveritySchema.options,
              },
              confidence: { type: Type.NUMBER },
            },
            required: ["label", "description", "severity"],
          },
        },
      },
      required: [
        "title",
        "description",
        "bulletPoints",
        "itemSpecifics",
        "recommendedPriceCents",
        "pricingRationale",
        "compSearchQueries",
        "measurements",
        "flaws",
      ],
    },
    marketplaceDrafts: {
      type: Type.OBJECT,
      properties: {
        ebay: marketplaceDraftJsonSchema,
        grailed: marketplaceDraftJsonSchema,
        poshmark: marketplaceDraftJsonSchema,
        depop: marketplaceDraftJsonSchema,
        etsy: marketplaceDraftJsonSchema,
      },
      required: ["ebay", "grailed", "poshmark", "depop", "etsy"],
    },
    warnings: { type: Type.ARRAY, items: shortAiTextJsonSchema },
  },
  required: ["identification", "listingDraft", "marketplaceDrafts", "warnings"],
};
