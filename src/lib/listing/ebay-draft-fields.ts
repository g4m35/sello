// Shared readers for the eBay slice of a draft's marketplaceDrafts JSON. Kept in
// one place so the readiness view, the approve gate, and the publish preflight
// all interpret the saved category / aspects / quantity identically.

export function asStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string" && v.trim()) out[k] = v;
  }
  return out;
}

export type EbayDraftFields = {
  categoryId: string | null;
  /** Raw saved quantity (null when never set, so a default of 1 is distinguishable). */
  quantity: number | null;
  aspects: Record<string, string>;
};

export function readEbayDraftFields(marketplaceDrafts: unknown): EbayDraftFields {
  if (!marketplaceDrafts || typeof marketplaceDrafts !== "object") {
    return { categoryId: null, quantity: null, aspects: {} };
  }
  const ebay = (marketplaceDrafts as Record<string, unknown>).ebay;
  if (!ebay || typeof ebay !== "object") {
    return { categoryId: null, quantity: null, aspects: {} };
  }
  const record = ebay as Record<string, unknown>;
  return {
    categoryId:
      typeof record.categoryId === "string" && record.categoryId.trim()
        ? record.categoryId
        : null,
    quantity: typeof record.quantity === "number" ? record.quantity : null,
    aspects: asStringRecord(record.aspects),
  };
}
