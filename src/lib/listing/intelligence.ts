// Listing intelligence: pure, deterministic inference of what an item is and
// what each marketplace needs for it, so sellers never have to know raw
// marketplace category IDs or measurement conventions. No network calls; all
// inference is from already-saved listing data. Anything uncertain is
// expressed as suggestions + confidence, never silently guessed.

export type Department = "men" | "women" | "unisex" | "unknown";

export type ItemType =
  | "sneakers"
  | "tshirt"
  | "hoodie"
  | "jeans"
  | "jacket"
  | "top"
  | "dress"
  | "bag"
  | "accessory"
  | "other";

export type MeasurementProfile =
  | "shoes"
  | "apparel_top"
  | "apparel_bottom"
  | "outerwear"
  | "dress"
  | "accessory"
  | "bag"
  | "other";

export type EbayCategoryConfidence = "high" | "medium" | "low" | "none";

export type EbayCategorySuggestion = { id: string; name: string };

// Deterministic local map of common fashion-resale eBay categories (EBAY_US
// leaf categories). The eBay Taxonomy API is the future-compatible path for
// long-tail items; these cover the core resale assortment offline.
export const EBAY_FASHION_CATEGORIES = {
  mensAthleticShoes: { id: "15709", name: "Men's Athletic Shoes" },
  womensAthleticShoes: { id: "95672", name: "Women's Athletic Shoes" },
  mensTShirts: { id: "15687", name: "Men's T-Shirts" },
  mensHoodies: { id: "155183", name: "Men's Hoodies & Sweatshirts" },
  mensJeans: { id: "11483", name: "Men's Jeans" },
  mensJackets: { id: "57988", name: "Men's Jackets & Coats" },
  womensTops: { id: "53159", name: "Women's Tops" },
  womensJeans: { id: "11554", name: "Women's Jeans" },
  womensDresses: { id: "63861", name: "Women's Dresses" },
} as const satisfies Record<string, EbayCategorySuggestion>;

export type ListingIntelligenceInput = {
  title: string | null;
  brand: string | null;
  description: string | null;
  /** InventoryItem.category (ProductCategory enum value) when present. */
  productCategory: string | null;
  size: string | null;
  itemSpecifics: Record<string, string>;
  tags: string[];
  /** Seller-saved eBay category override (marketplaceDrafts.ebay.categoryId). */
  savedEbayCategoryId: string | null;
};

export type EbayCategoryResolution = {
  /** Category the dry run / payloads may use: saved override or high-confidence inference. */
  resolvedId: string | null;
  resolvedName: string | null;
  source: "saved" | "inferred" | null;
  confidence: EbayCategoryConfidence;
  /** Ordered best-first; shown whenever the seller should review or choose. */
  suggestions: EbayCategorySuggestion[];
};

export type RecommendedMeasurement = { label: string; unit: "in" };

export type ListingIntelligence = {
  itemType: ItemType;
  department: Department;
  measurementProfile: MeasurementProfile;
  /** How the item's size field should be treated. Shoe sizes are sizes, never measurements. */
  sizeRole: "shoe_size" | "apparel_size" | "none";
  ebayCategory: EbayCategoryResolution;
  /** Set when the resolved category disagrees with the detected item type. */
  categoryConflict: EbayCategoryConflict | null;
  recommendedMeasurements: RecommendedMeasurement[];
};

const C = EBAY_FASHION_CATEGORIES;

function corpusOf(input: ListingIntelligenceInput): string {
  return [
    input.title ?? "",
    input.brand ?? "",
    input.description ?? "",
    ...input.tags,
    ...Object.entries(input.itemSpecifics).map(([k, v]) => `${k} ${v}`),
  ]
    .join(" ")
    .toLowerCase();
}

const WOMEN_RE = /\bwomen'?s?\b|\bwmns?\b|\bladies\b|\bwoman'?s?\b|\bfemale\b|\bgirls?\b/;
const MEN_RE = /\bmen'?s?\b|\bmale\b/;
const UNISEX_RE = /\bunisex\b/;

export function detectDepartment(input: ListingIntelligenceInput): Department {
  for (const [key, value] of Object.entries(input.itemSpecifics)) {
    if (/department|gender/i.test(key)) {
      const v = value.toLowerCase();
      if (WOMEN_RE.test(v)) return "women";
      if (MEN_RE.test(v)) return "men";
      if (UNISEX_RE.test(v)) return "unisex";
    }
  }

  const corpus = corpusOf(input);
  if (UNISEX_RE.test(corpus)) return "unisex";
  if (WOMEN_RE.test(corpus)) return "women";
  if (MEN_RE.test(corpus)) return "men";

  // Women's shoe-size notation ("8W", "W 8.5").
  const size = (input.size ?? "").trim().toLowerCase();
  if (/^w\s?\d/.test(size) || /\d\s?w$/.test(size)) return "women";

  return "unknown";
}

const SNEAKER_RE =
  /\bsneakers?\b|\bshoes?\b|\btrainers?\b|\bdunk\b|\bjordan\b|\byeezy\b|\bair max\b|\bair force\b|\bnew balance\b|\bsamba\b|\bgazelle\b|\bfoam runner\b/;
const DRESS_RE = /\bdress\b/;
// Explicit hoodie/sweatshirt words only. "crewneck" is deliberately NOT here: a
// crewneck is a neckline shared by tees, sweaters, and sweatshirts, so it is
// disambiguated against tee signals in detectItemType rather than assumed to be
// a sweatshirt.
const HOODIE_RE = /\bhoodies?\b|\bsweatshirts?\b|\bzip[- ]?up hoodie\b/;
const JEANS_RE = /\bjeans\b|\bdenim pants\b|\bdenim jeans?\b/;
const JACKET_RE = /\bjackets?\b|\bcoats?\b|\bpuffers?\b|\bbombers?\b|\bparkas?\b|\bwindbreakers?\b|\banoraks?\b/;
// Strong tee signals (t-shirt, tee, short sleeve). A crewneck only counts as a
// tee when one of these is also present (e.g. "crewneck t-shirt").
const TSHIRT_RE = /\bt[- ]?shirts?\b|\btees?\b|\bshort[- ]?sleeve(?:d)?\b/;
const CREWNECK_RE = /\bcrew[- ]?necks?\b/;
// Generic "shirt" is a weak top signal, checked only after the specific
// garments so "dress shirt" / "flannel shirt" still land in a top category.
const SHIRT_RE = /\bshirts?\b/;
const TOP_RE = /\btops?\b|\bblouses?\b|\bcamis?\b/;
const BAG_RE = /\bbags?\b|\bbackpacks?\b|\btotes?\b|\bcrossbody\b|\bduffle\b|\bpurses?\b|\bhandbags?\b/;
const ACCESSORY_RE =
  /\bhats?\b|\bcaps?\b|\bbeanies?\b|\bbelts?\b|\bscar(?:f|ves)\b|\bwallets?\b|\bsunglasses\b|\bsocks?\b|\bgloves?\b/;

export function detectItemType(input: ListingIntelligenceInput): ItemType {
  const corpus = corpusOf(input);

  // Order matters: the saved product category is the strongest signal,
  // "dress shirt"/"dress shoes" are not dresses, and generic words like
  // "shirt" are checked after the more specific garment words.
  if (input.productCategory === "sneakers") return "sneakers";
  if (DRESS_RE.test(corpus) && !/\bdress (shirts?|shoes?)\b/.test(corpus)) {
    return "dress";
  }
  if (SNEAKER_RE.test(corpus)) return "sneakers";

  // T-shirt vs hoodie/sweatshirt disambiguation. An explicit hoodie/sweatshirt
  // word always wins; otherwise an explicit tee word wins (so a "crewneck
  // t-shirt" is a T-shirt, not a sweatshirt); a bare crewneck with no tee word
  // is treated as a crewneck sweatshirt.
  if (HOODIE_RE.test(corpus)) return "hoodie";
  if (TSHIRT_RE.test(corpus)) return "tshirt";
  if (CREWNECK_RE.test(corpus)) return "hoodie";

  if (JEANS_RE.test(corpus)) return "jeans";
  if (JACKET_RE.test(corpus)) return "jacket";
  if (SHIRT_RE.test(corpus)) return "tshirt";
  if (TOP_RE.test(corpus)) return "top";
  if (BAG_RE.test(corpus)) return "bag";
  if (ACCESSORY_RE.test(corpus) || input.productCategory === "accessories") {
    return "accessory";
  }
  return "other";
}

function findCategoryName(id: string): string | null {
  for (const category of Object.values(C)) {
    if (category.id === id) return category.name;
  }
  return null;
}

type Inference = {
  best: EbayCategorySuggestion | null;
  confidence: EbayCategoryConfidence;
  suggestions: EbayCategorySuggestion[];
};

function inferCategory(itemType: ItemType, department: Department): Inference {
  const mensOrUnclear = department !== "women";

  switch (itemType) {
    case "sneakers":
      return department === "women"
        ? { best: C.womensAthleticShoes, confidence: "high", suggestions: [C.womensAthleticShoes, C.mensAthleticShoes] }
        : { best: C.mensAthleticShoes, confidence: "high", suggestions: [C.mensAthleticShoes, C.womensAthleticShoes] };
    case "dress":
      return { best: C.womensDresses, confidence: "high", suggestions: [C.womensDresses] };
    case "tshirt":
      return mensOrUnclear
        ? { best: C.mensTShirts, confidence: "high", suggestions: [C.mensTShirts, C.womensTops] }
        : { best: C.womensTops, confidence: "high", suggestions: [C.womensTops, C.mensTShirts] };
    case "hoodie":
      return mensOrUnclear
        ? { best: C.mensHoodies, confidence: "high", suggestions: [C.mensHoodies, C.womensTops] }
        : // No women's hoodie category in the local map: recommend, don't assert.
          { best: C.womensTops, confidence: "medium", suggestions: [C.womensTops, C.mensHoodies] };
    case "jeans":
      if (department === "men" || department === "unisex") {
        return { best: C.mensJeans, confidence: "high", suggestions: [C.mensJeans, C.womensJeans] };
      }
      if (department === "women") {
        return { best: C.womensJeans, confidence: "high", suggestions: [C.womensJeans, C.mensJeans] };
      }
      // Jeans without a department are genuinely ambiguous.
      return { best: null, confidence: "low", suggestions: [C.mensJeans, C.womensJeans] };
    case "jacket":
      return mensOrUnclear
        ? { best: C.mensJackets, confidence: "high", suggestions: [C.mensJackets] }
        : { best: null, confidence: "low", suggestions: [C.mensJackets, C.womensTops] };
    case "top":
      if (department === "women") {
        return { best: C.womensTops, confidence: "high", suggestions: [C.womensTops] };
      }
      return { best: null, confidence: "medium", suggestions: [C.womensTops, C.mensTShirts] };
    case "bag":
    case "accessory":
    case "other":
      return { best: null, confidence: "none", suggestions: [] };
  }
}

export function resolveEbayCategory(
  input: ListingIntelligenceInput,
  itemType: ItemType,
  department: Department,
): EbayCategoryResolution {
  const saved = input.savedEbayCategoryId?.trim();
  const inference = inferCategory(itemType, department);

  if (saved) {
    return {
      resolvedId: saved,
      resolvedName: findCategoryName(saved),
      source: "saved",
      confidence: "high",
      suggestions: inference.suggestions,
    };
  }

  if (inference.confidence === "high" && inference.best) {
    return {
      resolvedId: inference.best.id,
      resolvedName: inference.best.name,
      source: "inferred",
      confidence: "high",
      suggestions: inference.suggestions,
    };
  }

  return {
    resolvedId: null,
    resolvedName: null,
    source: null,
    confidence: inference.confidence,
    suggestions: inference.suggestions,
  };
}

// Which item types each local eBay category legitimately represents. Used to
// catch a saved/resolved category that disagrees with what the item looks like
// (e.g. a T-shirt left in the Hoodies & Sweatshirts category), so the seller can
// be asked to confirm instead of being forced through hoodie-only aspects.
const CATEGORY_ITEM_TYPES: Record<string, ItemType[]> = {
  "15709": ["sneakers"],
  "95672": ["sneakers"],
  "15687": ["tshirt", "top"],
  "155183": ["hoodie"],
  "11483": ["jeans"],
  "57988": ["jacket"],
  "53159": ["top", "tshirt"],
  "11554": ["jeans"],
  "63861": ["dress"],
};

const ITEM_TYPE_LABELS: Record<ItemType, string> = {
  sneakers: "pair of sneakers",
  tshirt: "T-shirt",
  hoodie: "hoodie or sweatshirt",
  jeans: "pair of jeans",
  jacket: "jacket or coat",
  top: "top",
  dress: "dress",
  bag: "bag",
  accessory: "accessory",
  other: "item",
};

export type EbayCategoryConflict = {
  detectedItemType: ItemType;
  /** Seller-facing label for what the item looks like (e.g. "T-shirt"). */
  detectedLabel: string;
  categoryId: string;
  categoryName: string;
};

/**
 * Returns a conflict when a resolved eBay category clearly disagrees with the
 * detected item type, so the UI can prompt the seller to confirm the category
 * rather than silently requiring the wrong aspects. Returns null when the
 * category fits, the item is too ambiguous to judge ("other"), or the category
 * is unknown to the local map (e.g. a live Taxonomy leaf we can't reason about).
 */
export function detectEbayCategoryConflict(
  itemType: ItemType,
  categoryId: string | null,
): EbayCategoryConflict | null {
  if (!categoryId) return null;
  if (itemType === "other") return null;
  const expected = CATEGORY_ITEM_TYPES[categoryId];
  if (!expected || expected.includes(itemType)) return null;
  const categoryName = findCategoryName(categoryId);
  if (!categoryName) return null;
  return {
    detectedItemType: itemType,
    detectedLabel: ITEM_TYPE_LABELS[itemType],
    categoryId,
    categoryName,
  };
}

const PROFILE_BY_TYPE: Record<ItemType, MeasurementProfile> = {
  sneakers: "shoes",
  tshirt: "apparel_top",
  hoodie: "apparel_top",
  top: "apparel_top",
  jeans: "apparel_bottom",
  jacket: "outerwear",
  dress: "dress",
  bag: "bag",
  accessory: "accessory",
  other: "other",
};

const RECOMMENDED_MEASUREMENTS: Record<MeasurementProfile, RecommendedMeasurement[]> = {
  shoes: [],
  apparel_top: [
    { label: "Pit to pit", unit: "in" },
    { label: "Length", unit: "in" },
    { label: "Shoulders", unit: "in" },
    { label: "Sleeve", unit: "in" },
  ],
  apparel_bottom: [
    { label: "Waist", unit: "in" },
    { label: "Inseam", unit: "in" },
    { label: "Rise", unit: "in" },
    { label: "Leg opening", unit: "in" },
  ],
  outerwear: [
    { label: "Pit to pit", unit: "in" },
    { label: "Length", unit: "in" },
    { label: "Shoulders", unit: "in" },
    { label: "Sleeve", unit: "in" },
  ],
  dress: [
    { label: "Bust", unit: "in" },
    { label: "Waist", unit: "in" },
    { label: "Length", unit: "in" },
  ],
  accessory: [],
  bag: [],
  other: [],
};

export function measurementProfileFor(itemType: ItemType): MeasurementProfile {
  return PROFILE_BY_TYPE[itemType];
}

export function recommendedMeasurementsFor(
  profile: MeasurementProfile,
): RecommendedMeasurement[] {
  return RECOMMENDED_MEASUREMENTS[profile];
}

/** Profiles whose listings benefit from garment measurements. */
export function profileUsesClothingMeasurements(profile: MeasurementProfile): boolean {
  return (
    profile === "apparel_top" ||
    profile === "apparel_bottom" ||
    profile === "outerwear" ||
    profile === "dress"
  );
}

export function analyzeListing(input: ListingIntelligenceInput): ListingIntelligence {
  const department = detectDepartment(input);
  const itemType = detectItemType(input);
  const measurementProfile = measurementProfileFor(itemType);
  const ebayCategory = resolveEbayCategory(input, itemType, department);

  return {
    itemType,
    department,
    measurementProfile,
    sizeRole:
      measurementProfile === "shoes"
        ? "shoe_size"
        : profileUsesClothingMeasurements(measurementProfile)
          ? "apparel_size"
          : "none",
    ebayCategory,
    categoryConflict: detectEbayCategoryConflict(itemType, ebayCategory.resolvedId),
    recommendedMeasurements: recommendedMeasurementsFor(measurementProfile),
  };
}
