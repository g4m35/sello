import { normalizedSize } from "@/lib/comps/size";

export function stockxIdentityIssue(item: { styleCode?: string | null; size?: string | null; brand?: string | null }, match: unknown): string | null {
  const selected = match && typeof match === "object" && !Array.isArray(match) ? match as Record<string, unknown> : {};
  const text = (v: unknown) => typeof v === "string" ? v.trim().toLowerCase() : "";
  const code = (v: unknown) => text(v).replace(/[^a-z0-9]/g, "");
  if (item.styleCode && code(item.styleCode) !== code(selected.style)) return "Choose a StockX product with the same style code as this item.";
  if (item.size && normalizedSize(item.size) !== normalizedSize(text(selected.size))) return "Choose the matching StockX size before posting.";
  if (item.brand && selected.brand && text(item.brand) !== text(selected.brand)) return "The selected StockX brand does not match this item.";
  return null;
}
