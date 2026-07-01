import type { CompQuery } from "@/lib/comps/source";
import { buildCompQueryVariants } from "@/lib/comps/query";

export type MatchInput = {
  accountId?: string | null;
  draftId?: string | null;
  productName: string;
  brand: string | null;
  styleCode: string | null;
  size: string | null;
  category: string;
  stockxProductId?: string | null;
  stockxVariantId?: string | null;
  colorway?: string | null;
  condition?: string | null;
  description?: string | null;
};

// Builds the best search query for an item. Sneakers/streetwear are most
// precisely matched by style code; otherwise fall back to brand + product name.
export function buildCompQuery(item: MatchInput): CompQuery {
  const title = item.productName.trim();
  const parts = [item.brand, item.styleCode || title]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  const keywords = (parts.length ? parts.join(" ") : title).trim();
  return {
    accountId: item.accountId ?? null,
    draftId: item.draftId ?? null,
    styleCode: item.styleCode?.trim() || null,
    brand: item.brand?.trim() || null,
    title,
    size: item.size?.trim() || null,
    category: item.category,
    stockxProductId: item.stockxProductId?.trim() || null,
    stockxVariantId: item.stockxVariantId?.trim() || null,
    keywords,
    variants: buildCompQueryVariants(item),
  };
}
