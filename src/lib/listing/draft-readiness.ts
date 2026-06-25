import type { ItemCondition } from "@/generated/prisma/client";
import {
  countMeaningfulBullets,
  PLACEHOLDER_PRODUCT_NAME,
  READINESS_THRESHOLDS,
} from "@/lib/lifecycle/readiness";

import { classifyMissingAspects, resolveEbayAspects } from "./ebay-aspects";
import { analyzeListing } from "./intelligence";

// Single source of truth for "is this draft complete enough to mark ready and
// publish". It folds the content checks (title/description/bullets/price/
// marketplaces) together with the eBay item-level publish requirements
// (condition, resolvable category, size, required item specifics, a photo,
// a valid quantity). The same evaluation drives the listing detail rail, the
// inventory/dashboard counts, and the approve gate, and it is a strict subset
// of the eBay publish preflight (which additionally checks account-level eBay
// connection + business policies). Pure and synchronous: no network, no DB.

export type DraftReadinessIssueCode =
  | "unidentified_product"
  | "title_too_short"
  | "description_too_short"
  | "insufficient_bullets"
  | "no_marketplace"
  | "missing_price"
  | "missing_condition"
  | "missing_category"
  | "missing_size"
  | "missing_item_specifics"
  | "missing_photos"
  | "invalid_quantity"
  | "sale_wording";

export type DraftReadinessIssue = {
  code: DraftReadinessIssueCode;
  message: string;
};

export type DraftReadinessCheckState = "done" | "warn" | "miss";

export type DraftReadinessCheck = {
  id: string;
  title: string;
  sub: string;
  state: DraftReadinessCheckState;
  blocking: boolean;
};

export type DraftReadinessInput = {
  productName: string | null | undefined;
  title: string;
  description: string;
  bulletPoints: string[];
  selectedMarketplaces: string[];
  recommendedPriceCents: number | null | undefined;
  condition: ItemCondition;
  /** InventoryItem.category (ProductCategory enum value) when present. */
  productCategory: string | null;
  brand: string | null;
  size: string | null;
  colorway: string | null;
  /** Draft-level free-form item specifics. */
  itemSpecifics: Record<string, string>;
  /** marketplaceDrafts.ebay.categoryId override. */
  savedEbayCategoryId: string | null;
  /** marketplaceDrafts.ebay.aspects overrides. */
  savedAspects: Record<string, string>;
  /** marketplaceDrafts.ebay.quantity (null = resale default of 1). */
  savedQuantity: number | null;
  photoCount: number;
};

export type DraftReadinessResult = {
  ready: boolean;
  issues: DraftReadinessIssue[];
  checks: DraftReadinessCheck[];
};

const unsafeSaleWordingPatterns = [
  /\btest\b/i,
  /do\s+not\s+buy/i,
  /\bdummy\b/i,
  /\bfake\b/i,
  /\bplaceholder\b/i,
  /not\s+for\s+sale/i,
];

function hasUnsafeSaleWording(...values: Array<string | null | undefined>): boolean {
  const text = values
    .filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    .join(" ");
  return unsafeSaleWordingPatterns.some((pattern) => pattern.test(text));
}

export function evaluateDraftReadiness(
  input: DraftReadinessInput,
): DraftReadinessResult {
  const productName = input.productName?.trim() ?? "";
  const title = input.title.trim();
  const description = input.description.trim();
  const bullets = countMeaningfulBullets(input.bulletPoints);
  const price = input.recommendedPriceCents;
  const photoCount = input.photoCount;

  const intelligence = analyzeListing({
    title: input.title || productName || null,
    brand: input.brand,
    description: input.description || null,
    productCategory: input.productCategory,
    size: input.size,
    itemSpecifics: input.itemSpecifics,
    tags: [],
    savedEbayCategoryId: input.savedEbayCategoryId,
  });
  const categoryId = intelligence.ebayCategory.resolvedId;
  const aspects = resolveEbayAspects(categoryId, {
    brand: input.brand,
    size: input.size,
    colorway: input.colorway,
    department: intelligence.department,
    measurementProfile: intelligence.measurementProfile,
    itemSpecifics: input.itemSpecifics,
    savedAspects: input.savedAspects,
  });
  const missingAspects = classifyMissingAspects(aspects.missingRequired);
  const sizeRequired = intelligence.sizeRole !== "none";

  const quantity = input.savedQuantity;
  const quantityInvalid =
    quantity !== null &&
    quantity !== undefined &&
    (!Number.isInteger(quantity) || quantity <= 0);

  const priceOk =
    price != null && Number.isFinite(price) && price > 0;
  const categoryConflict = Boolean(intelligence.categoryConflict);

  // eBay's field requirements (category, size aspect, item specifics, quantity)
  // only gate readiness when eBay is actually a selected channel. A copy-ready
  // listing targeting only Etsy/Depop/etc. is "ready" once its shared content is
  // complete and must not be blocked by eBay-only fields.
  const ebaySelected = input.selectedMarketplaces.includes("ebay");

  const checks: DraftReadinessCheck[] = [
    {
      id: "identified",
      title: "Product identified",
      sub:
        productName && productName !== PLACEHOLDER_PRODUCT_NAME
          ? productName
          : "Awaiting identification",
      state: productName && productName !== PLACEHOLDER_PRODUCT_NAME ? "done" : "miss",
      blocking: true,
    },
    {
      id: "title",
      title: "Title",
      sub: `${title.length}/${READINESS_THRESHOLDS.titleMinLength}+ characters`,
      state: title.length >= READINESS_THRESHOLDS.titleMinLength ? "done" : "miss",
      blocking: true,
    },
    {
      id: "description",
      title: "Description",
      sub: `${description.length}/${READINESS_THRESHOLDS.descriptionMinLength}+ characters`,
      state:
        description.length >= READINESS_THRESHOLDS.descriptionMinLength ? "done" : "miss",
      blocking: true,
    },
    {
      id: "bullets",
      title: "Highlights",
      sub: `${bullets}/${READINESS_THRESHOLDS.minBulletPoints}+ bullet points`,
      state: bullets >= READINESS_THRESHOLDS.minBulletPoints ? "done" : "miss",
      blocking: true,
    },
    {
      id: "price",
      title: "Price",
      sub: priceOk ? "Seller price set" : "Set a price above $0",
      state: priceOk ? "done" : "miss",
      blocking: true,
    },
    {
      id: "marketplaces",
      title: "Channels",
      sub: `${input.selectedMarketplaces.length} selected`,
      state:
        input.selectedMarketplaces.length >= READINESS_THRESHOLDS.minMarketplaces
          ? "done"
          : "miss",
      blocking: true,
    },
    {
      id: "condition",
      title: "Condition",
      sub: input.condition === "unknown" ? "Set the item condition" : "Set",
      state: input.condition === "unknown" ? "miss" : "done",
      blocking: true,
    },
  ];

  if (ebaySelected) {
    checks.push({
      id: "category",
      title: "Category",
      sub: categoryId && !categoryConflict
        ? intelligence.ebayCategory.resolvedName ?? "Selected"
        : categoryConflict
          ? "Confirm the category"
          : "Choose a category",
      state: categoryId && !categoryConflict ? "done" : "miss",
      blocking: true,
    });

    if (sizeRequired) {
      checks.push({
        id: "size",
        title: "Size",
        sub: missingAspects.size ? "Add a size" : input.size?.trim() || "Set",
        state: missingAspects.size ? "miss" : "done",
        blocking: true,
      });
    }

    if (missingAspects.specifics.length > 0) {
      checks.push({
        id: "item_specifics",
        title: "Item specifics",
        sub: `Add ${missingAspects.specifics.join(", ")}`,
        state: "miss",
        blocking: true,
      });
    }
  }

  checks.push({
    id: "photos",
    title: "Photos",
    sub: `${photoCount} of 3 recommended`,
    state: photoCount >= 3 ? "done" : photoCount >= 1 ? "warn" : "miss",
    blocking: true,
  });

  if (ebaySelected && quantityInvalid) {
    checks.push({
      id: "quantity",
      title: "Quantity",
      sub: "Set a quantity of 1 or more",
      state: "miss",
      blocking: true,
    });
  }

  const issues: DraftReadinessIssue[] = [];
  const push = (code: DraftReadinessIssueCode, message: string) =>
    issues.push({ code, message });

  if (!(productName && productName !== PLACEHOLDER_PRODUCT_NAME)) {
    push("unidentified_product", "Wait for identification or set a real product name.");
  }
  if (title.length < READINESS_THRESHOLDS.titleMinLength) {
    push("title_too_short", `Title needs at least ${READINESS_THRESHOLDS.titleMinLength} characters.`);
  }
  if (description.length < READINESS_THRESHOLDS.descriptionMinLength) {
    push(
      "description_too_short",
      `Description needs at least ${READINESS_THRESHOLDS.descriptionMinLength} characters.`,
    );
  }
  if (bullets < READINESS_THRESHOLDS.minBulletPoints) {
    push("insufficient_bullets", `Add at least ${READINESS_THRESHOLDS.minBulletPoints} bullet points.`);
  }
  if (input.selectedMarketplaces.length < READINESS_THRESHOLDS.minMarketplaces) {
    push("no_marketplace", "Select at least one marketplace.");
  }
  if (!priceOk) {
    push("missing_price", "Set a seller price above $0.");
  }
  if (input.condition === "unknown") {
    push("missing_condition", "Set the item condition.");
  }
  if (hasUnsafeSaleWording(input.title, input.description)) {
    push("sale_wording", "Remove test/placeholder wording from the title or description.");
  }
  if (ebaySelected && (!categoryId || categoryConflict)) {
    push("missing_category", "Choose the eBay category for this item.");
  }
  if (ebaySelected && missingAspects.size) {
    push("missing_size", "Add a size.");
  }
  if (ebaySelected && missingAspects.specifics.length > 0) {
    push("missing_item_specifics", `Add item specifics: ${missingAspects.specifics.join(", ")}.`);
  }
  if (photoCount < 1) {
    push("missing_photos", "Add at least one photo.");
  }
  if (ebaySelected && quantityInvalid) {
    push("invalid_quantity", "Set a quantity of 1 or more.");
  }

  const ready = !checks.some((c) => c.blocking && c.state === "miss");
  return { ready, issues, checks };
}
