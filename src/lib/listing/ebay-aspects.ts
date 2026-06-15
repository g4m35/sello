// Required eBay item specifics (aspects) for the deterministic local category
// map. Pure and offline: this is the same strategy as category inference:
// cover the core resale assortment locally, keep the eBay Taxonomy API
// (getItemAspectsForCategory) as the future long-tail path (see
// docs/SELLO_ROADMAP.md). Values are resolved from data Sello already has;
// only genuinely unknown values are asked of the seller.

import type { Department, MeasurementProfile } from "./intelligence";

export type EbayAspectRequirement = {
  /** Exact eBay aspect name as sent in the payload. */
  name: string;
  /** Plain-language label shown to sellers. */
  label: string;
  required: boolean;
};

const SHOE_ASPECTS: EbayAspectRequirement[] = [
  { name: "Brand", label: "Brand", required: true },
  { name: "US Shoe Size", label: "Shoe size", required: true },
  { name: "Department", label: "Department (Men/Women)", required: true },
  { name: "Color", label: "Color", required: true },
  { name: "Style", label: "Style (e.g. Sneaker)", required: false },
  { name: "Type", label: "Type (e.g. Athletic)", required: false },
  { name: "Model", label: "Model (e.g. Dunk Low)", required: false },
  { name: "Upper Material", label: "Upper material", required: false },
];

const APPAREL_ASPECTS: EbayAspectRequirement[] = [
  { name: "Brand", label: "Brand", required: true },
  { name: "Size", label: "Size", required: true },
  { name: "Department", label: "Department (Men/Women)", required: true },
  { name: "Color", label: "Color", required: true },
  // eBay requires Size Type for apparel; "Regular" is the honest default and can
  // be overridden with a saved aspect for Big & Tall / Plus / Petite items.
  { name: "Size Type", label: "Size type", required: true },
  { name: "Type", label: "Type", required: false },
  { name: "Style", label: "Style", required: false },
];

// eBay requires the Department aspect in the publish payload even for
// gender-specific categories (publishOffer rejects "Men's Jackets & Coats"/57988
// with "item specific Department is missing"). Department therefore stays a
// required aspect; it is auto-resolved from the category's inherent gender
// (CATEGORY_DEPARTMENT) so the seller is still never asked for it.
const ASPECTS_BY_CATEGORY: Record<string, EbayAspectRequirement[]> = {
  // Men's / Women's Athletic Shoes
  "15709": SHOE_ASPECTS,
  "95672": SHOE_ASPECTS,
  // Men's T-Shirts, Hoodies, Jeans, Jackets; Women's Tops, Jeans, Dresses
  "15687": APPAREL_ASPECTS,
  "155183": APPAREL_ASPECTS,
  "11483": APPAREL_ASPECTS,
  "57988": APPAREL_ASPECTS,
  "53159": APPAREL_ASPECTS,
  "11554": APPAREL_ASPECTS,
  "63861": APPAREL_ASPECTS,
};

// Gender-specific category -> eBay Department value. Used to auto-fill the
// Department aspect from the category alone when the listing's detected
// department is "unknown", so single-gender categories never block on it.
const CATEGORY_DEPARTMENT: Record<string, string> = {
  "15709": "Men",
  "95672": "Women",
  "15687": "Men",
  "155183": "Men",
  "11483": "Men",
  "57988": "Men",
  "53159": "Women",
  "11554": "Women",
  "63861": "Women",
};

export function ebayAspectRequirementsFor(
  categoryId: string | null,
): EbayAspectRequirement[] {
  if (!categoryId) return [];
  return ASPECTS_BY_CATEGORY[categoryId] ?? [];
}

export type EbayAspectSourceData = {
  brand: string | null;
  size: string | null;
  colorway: string | null;
  department: Department;
  measurementProfile: MeasurementProfile;
  itemSpecifics: Record<string, string>;
  /** Seller-saved aspect overrides (marketplaceDrafts.ebay.aspects). */
  savedAspects: Record<string, string>;
};

export type EbayAspectResolution = {
  /** Aspect name -> resolved value; merged into the publish payload. */
  values: Record<string, string>;
  missingRequired: EbayAspectRequirement[];
  missingRecommended: EbayAspectRequirement[];
};

function departmentAspectValue(
  department: Department,
  categoryId: string | null,
): string | null {
  switch (department) {
    case "men":
      return "Men";
    case "women":
      return "Women";
    case "unisex":
      return "Unisex Adult";
    case "unknown":
      return categoryId ? CATEGORY_DEPARTMENT[categoryId] ?? null : null;
  }
}

function lookupSpecific(
  itemSpecifics: Record<string, string>,
  aspectName: string,
): string | null {
  for (const [key, value] of Object.entries(itemSpecifics)) {
    if (key.trim().toLowerCase() === aspectName.toLowerCase() && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function resolveValue(
  aspect: EbayAspectRequirement,
  data: EbayAspectSourceData,
  categoryId: string | null,
): string | null {
  const saved = data.savedAspects[aspect.name]?.trim();
  if (saved) return saved;

  const fromSpecifics = lookupSpecific(data.itemSpecifics, aspect.name);
  if (fromSpecifics) return fromSpecifics;

  switch (aspect.name) {
    case "Brand":
      return data.brand?.trim() || null;
    case "US Shoe Size":
      // The item's size IS the shoe size for footwear; normalize "US 10" to "10".
      return data.measurementProfile === "shoes"
        ? data.size?.trim().replace(/^us\s*/i, "") || null
        : null;
    case "Size":
      return data.size?.trim() || null;
    case "Color":
      return data.colorway?.trim() || null;
    case "Department":
      return departmentAspectValue(data.department, categoryId);
    case "Size Type":
      // Default to Regular; a saved aspect (checked above) overrides it.
      return "Regular";
    case "Style":
      return data.measurementProfile === "shoes" ? "Sneaker" : null;
    case "Type":
      return data.measurementProfile === "shoes" ? "Athletic" : null;
    default:
      return null;
  }
}

export function resolveEbayAspects(
  categoryId: string | null,
  data: EbayAspectSourceData,
): EbayAspectResolution {
  const requirements = ebayAspectRequirementsFor(categoryId);
  const values: Record<string, string> = {};
  const missingRequired: EbayAspectRequirement[] = [];
  const missingRecommended: EbayAspectRequirement[] = [];

  for (const aspect of requirements) {
    const value = resolveValue(aspect, data, categoryId);
    if (value) {
      values[aspect.name] = value;
    } else if (aspect.required) {
      missingRequired.push(aspect);
    } else {
      missingRecommended.push(aspect);
    }
  }

  return { values, missingRequired, missingRecommended };
}
