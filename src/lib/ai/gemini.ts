import { createPartFromBase64, GoogleGenAI } from "@google/genai";

import type { PreparedListingPhoto } from "@/lib/storage/listing-photos";
import { getRequiredEnv } from "@/lib/errors";

import {
  geminiListingDraftResponseSchema,
  parseGeminiListingDraft,
  type GeminiListingDraft,
} from "./listing-draft";

export const GEMINI_PROMPT_VERSION = "listing-draft-v1";

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
