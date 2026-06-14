import type { CompQueryVariant } from "@/lib/comps/source";

export type QueryItemInput = {
  productName: string;
  brand: string | null;
  styleCode: string | null;
  size: string | null;
  category: string;
  colorway?: string | null;
  condition?: string | null;
  description?: string | null;
};

const CONDITION_WORDS: Record<string, string> = {
  new_with_tags: "new with tags",
  new_without_tags: "new",
  used_excellent: "preowned excellent",
  used_good: "preowned",
  used_fair: "preowned fair",
  for_parts: "for parts",
  unknown: "",
};

function compact(parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function uniqueVariants(variants: CompQueryVariant[]): CompQueryVariant[] {
  const seen = new Set<string>();
  const out: CompQueryVariant[] = [];
  for (const variant of variants) {
    const key = variant.keywords.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(variant);
  }
  return out;
}

export function buildCompQueryVariants(item: QueryItemInput): CompQueryVariant[] {
  const title = item.productName.trim();
  const condition = CONDITION_WORDS[item.condition ?? "unknown"] ?? "";
  const brand = item.brand?.trim() || null;
  const styleCode = item.styleCode?.trim() || null;
  const size = item.size?.trim() || null;
  const colorway = item.colorway?.trim() || null;

  const strictBase = styleCode
    ? compact([brand, styleCode, size])
    : compact([brand, title, colorway, size]);

  return uniqueVariants([
    {
      kind: "strict",
      keywords: compact([strictBase || title, "sold"]),
    },
    {
      kind: "broad",
      keywords: compact([brand, title, colorway, condition || "preowned"]),
    },
    {
      kind: "marketplace",
      keywords: compact([brand, title, item.category.replaceAll("_", " "), "sold"]),
    },
  ]);
}
