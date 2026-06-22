import { readEbayDraftFields } from "./ebay-draft-fields";
import { analyzeListing } from "./intelligence";

// Fills sensible eBay defaults into a freshly AI-generated draft so it lands
// much closer to publish-ready: the resale quantity defaults to 1, and a
// high-confidence inferred eBay category is set. It never overwrites a value
// the AI already provided, and it never invents a category it isn't confident
// about — an unresolved category stays empty so readiness shows the exact
// missing field instead of a fake-confident guess. Pure and synchronous.

export type DefaultEbayDraftInput = {
  title: string | null;
  brand: string | null;
  description: string | null;
  /** InventoryItem.category (ProductCategory enum value). */
  productCategory: string | null;
  size: string | null;
  itemSpecifics: Record<string, string>;
  /** Existing marketplaceDrafts JSON from the AI output. */
  marketplaceDrafts: unknown;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

export function applyDefaultEbayDraftFields(
  input: DefaultEbayDraftInput,
): Record<string, unknown> {
  const drafts = asObject(input.marketplaceDrafts);
  const existing = readEbayDraftFields(drafts);

  const intelligence = analyzeListing({
    title: input.title,
    brand: input.brand,
    description: input.description,
    productCategory: input.productCategory,
    size: input.size,
    itemSpecifics: input.itemSpecifics,
    tags: [],
    savedEbayCategoryId: existing.categoryId,
  });
  const highConfidence =
    intelligence.ebayCategory.confidence === "high" && !intelligence.categoryConflict;

  const categoryId =
    existing.categoryId ?? (highConfidence ? intelligence.ebayCategory.resolvedId : null);
  const quantity = existing.quantity ?? 1;

  const ebay = asObject(drafts.ebay);
  ebay.quantity = quantity;
  if (categoryId) {
    ebay.categoryId = categoryId;
  }
  drafts.ebay = ebay;
  return drafts;
}
