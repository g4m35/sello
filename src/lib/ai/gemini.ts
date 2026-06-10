import { createPartFromBase64, GoogleGenAI } from "@google/genai";

import type { PreparedListingPhoto } from "@/lib/storage/listing-photos";
import { getRequiredEnv } from "@/lib/errors";

import {
  geminiListingDraftResponseSchema,
  parseGeminiListingDraft,
  type GeminiListingDraft,
} from "./listing-draft";

export const GEMINI_PROMPT_VERSION = "listing-draft-v2";

const listingDraftPrompt = `
You are an expert resale listing assistant for streetwear, sneakers, and hype-fashion sellers.

Identify the item shown in 1-3 seller photos and produce one optimized master listing plus marketplace-specific drafts for eBay, Grailed, Poshmark, and Depop.

Rules:
- Return structured JSON only.
- Do not include markdown, prose, or code fences.
- Use null for styleCode, colorway, size, or recommendedPriceCents when the photos do not support a reliable answer.
- Do not invent live sold comp data. If pricing needs live comps, explain that in pricingRationale and provide compSearchQueries the seller can run.
- Be conservative about authenticity and condition. Add warnings when photos are insufficient.
- Keep titles buyer-search-friendly and within marketplace title limits.
- Measurements: never estimate or invent exact measurements from photos. Only fill a measurement value when it is clearly legible in a photo (size tag, ruler, or measuring tape). Otherwise, list the measurement labels a buyer would expect for this category (for example pit to pit and length for tops, insole length for sneakers) with value null and unit "unknown" so the seller can measure.
- Flaws: list only flaws that are visible in the photos, each with a short label, a factual description, and a severity. If no flaws are visible, return an empty flaws array. Never state that the item has no flaws; absence from the list only means none were visible.
`;

export type GeminiDraftResult = {
  draft: GeminiListingDraft;
  rawText: string;
  rawJson: unknown;
  model: string;
};

export async function generateListingDraftWithGemini(
  photos: PreparedListingPhoto[],
): Promise<GeminiDraftResult> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const ai = new GoogleGenAI({ apiKey: getRequiredEnv("GEMINI_API_KEY") });
  const imageParts = photos.map((photo) => createPartFromBase64(photo.base64, photo.mimeType));

  const response = await ai.models.generateContent({
    model,
    contents: [{ text: listingDraftPrompt }, ...imageParts],
    config: {
      responseMimeType: "application/json",
      responseSchema: geminiListingDraftResponseSchema,
    },
  });

  const rawText = response.text?.trim();

  if (!rawText) {
    throw new Error("Gemini returned an empty response.");
  }

  return {
    draft: parseGeminiListingDraft(rawText),
    rawText,
    rawJson: JSON.parse(rawText),
    model,
  };
}
