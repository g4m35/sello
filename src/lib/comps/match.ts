import type { CompQuery } from "@/lib/comps/source";

export type MatchInput = {
  productName: string;
  brand: string | null;
  styleCode: string | null;
  size: string | null;
  category: string;
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
    styleCode: item.styleCode?.trim() || null,
    brand: item.brand?.trim() || null,
    title,
    size: item.size?.trim() || null,
    category: item.category,
    keywords,
  };
}
