// Pure copy/paste export formatting for marketplaces without a publish
// adapter. This produces text the seller pastes into the marketplace's own
// listing form — it never publishes anything.
import { z } from "zod";

import type { Flaw, Measurement } from "@/lib/ai/listing-draft";
import {
  profileUsesClothingMeasurements,
  type MeasurementProfile,
} from "@/lib/listing/intelligence";
import { conditionLabel, formatMoneyCents } from "@/lib/view/format";

export const ExportMarketplaceSchema = z.enum([
  "depop",
  "poshmark",
  "grailed",
  "etsy",
  "vinted",
  "mercari",
]);
export type ExportMarketplace = z.infer<typeof ExportMarketplaceSchema>;

// One labelled copy target the guided listing panel renders with its own copy
// button, so the seller pastes each field into the right box on the sell form.
export type ExportField = {
  key: string;
  label: string;
  value: string;
};

export type ListingExportInput = {
  productName: string;
  brand: string | null;
  size: string | null;
  colorway: string | null;
  styleCode: string | null;
  category: string;
  condition: string;
  title: string;
  description: string;
  bulletPoints: string[];
  priceCents: number | null;
  itemSpecifics: Record<string, string>;
  tags: string[];
  measurements: Measurement[];
  flaws: Flaw[];
  /** From listing intelligence: decides whether garment measurements belong in the copy. */
  measurementProfile: MeasurementProfile;
};

export type ListingExport = {
  marketplace: ExportMarketplace;
  title: string;
  body: string;
  fields: ExportField[];
  warnings: string[];
};

const POSHMARK_TITLE_MAX = 80;
const MERCARI_TITLE_MAX = 80;
const DEPOP_HASHTAG_MAX = 8;
const MERCARI_HASHTAG_MAX = 3;
// Etsy allows up to 13 search tags, each up to 20 characters.
const ETSY_TAG_MAX = 13;
const ETSY_TAG_CHAR_MAX = 20;

const FLAW_KEY_HINTS = ["flaw", "defect", "damage", "stain", "hole", "repair"];
const MEASUREMENT_KEY_HINTS = [
  "measurement",
  "pit to pit",
  "chest",
  "length",
  "inseam",
  "waist",
  "shoulder",
  "sleeve",
  "rise",
  "hem",
];

function matchSpecifics(
  itemSpecifics: Record<string, string>,
  hints: string[],
): [string, string][] {
  return Object.entries(itemSpecifics).filter(([key]) => {
    const lower = key.toLowerCase();
    return hints.some((hint) => lower.includes(hint));
  });
}

function toHashtag(value: string): string {
  return `#${value.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
}

function hashtagLine(
  input: ListingExportInput,
  max: number = DEPOP_HASHTAG_MAX,
): string {
  const candidates = [
    ...input.tags,
    input.brand ?? "",
    input.category.replace(/_/g, " "),
  ];
  const seen = new Set<string>();
  const hashtags: string[] = [];
  for (const candidate of candidates) {
    const tag = toHashtag(candidate);
    if (tag.length < 3 || seen.has(tag)) continue;
    seen.add(tag);
    hashtags.push(tag);
    if (hashtags.length >= max) break;
  }
  return hashtags.join(" ");
}

function joinSections(sections: (string | null)[]): string {
  return sections.filter((s): s is string => s != null && s !== "").join("\n\n");
}

type ResolvedFields = {
  title: string;
  conditionText: string | null;
  priceText: string | null;
  flawSection: string | null;
  measurementSection: string | null;
  warnings: string[];
};

function measurementLine(measurement: Measurement): string {
  const unit = measurement.unit === "unknown" ? "" : ` ${measurement.unit}`;
  return `${measurement.label}: ${measurement.value}${unit}`;
}

function flawLine(flaw: Flaw): string {
  const severity =
    flaw.severity && flaw.severity !== "unknown" ? ` (${flaw.severity})` : "";
  return `- ${flaw.label}: ${flaw.description}${severity}`;
}

function resolveFields(input: ListingExportInput): ResolvedFields {
  const warnings: string[] = [];

  const title = input.title.trim() || input.productName.trim();
  if (!input.brand?.trim()) warnings.push("Missing brand");
  if (!input.size?.trim()) warnings.push("Missing size");
  if (input.priceCents == null) warnings.push("Missing price");

  const hasCondition = input.condition !== "unknown";
  if (!hasCondition) warnings.push("Missing condition");

  if (!input.description.trim()) warnings.push("Missing description");

  const legacyFlaws = matchSpecifics(input.itemSpecifics, FLAW_KEY_HINTS);

  // Structured flaws (AI-extracted or seller-entered) win; the itemSpecifics
  // key heuristic only covers drafts created before structured fields existed.
  // No flaws recorded means exactly that — never claim "no flaws".
  let flawSection: string | null = null;
  if (input.flaws.length > 0) {
    flawSection = ["Flaws:", ...input.flaws.map(flawLine)].join("\n");
  } else if (legacyFlaws.length > 0) {
    flawSection = legacyFlaws.map(([, value]) => `Flaws: ${value}`).join("\n");
  }

  // Only real, filled-in measurements ever appear in buyer-facing copy.
  // Placeholder rows (value null) live in the editor, not in the listing.
  const valuedMeasurements = input.measurements.filter((m) => m.value != null);
  const isApparel = profileUsesClothingMeasurements(input.measurementProfile);

  let measurementSection: string | null = null;
  if (valuedMeasurements.length > 0) {
    measurementSection = [
      "Measurements:",
      ...valuedMeasurements.map(measurementLine),
    ].join("\n");
  } else if (isApparel) {
    const legacyMeasurements = matchSpecifics(
      input.itemSpecifics,
      MEASUREMENT_KEY_HINTS,
    ).filter(([key]) => !legacyFlaws.some(([flawKey]) => flawKey === key));

    if (legacyMeasurements.length > 0) {
      measurementSection = [
        "Measurements:",
        ...legacyMeasurements.map(([key, value]) => `${key}: ${value}`),
      ].join("\n");
    } else {
      // Apparel buyers expect measurements; be honest that they are pending.
      // Shoes, bags, and accessories never get garment measurement filler.
      warnings.push("No measurements saved yet");
      measurementSection = "Measurements available upon request.";
    }
  }

  return {
    title,
    conditionText: hasCondition ? conditionLabel(input.condition) : null,
    priceText: input.priceCents != null ? formatMoneyCents(input.priceCents) : null,
    flawSection,
    measurementSection,
    warnings,
  };
}

function formatDepop(input: ListingExportInput, fields: ResolvedFields): string {
  const facts = [
    input.brand ? `Brand: ${input.brand}` : null,
    input.size ? `Size: ${input.size}` : null,
    fields.conditionText ? `Condition: ${fields.conditionText}` : null,
    input.colorway ? `Color: ${input.colorway}` : null,
    fields.priceText ? `Price: ${fields.priceText}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return joinSections([
    input.description.trim() || null,
    facts,
    fields.flawSection,
    fields.measurementSection,
    hashtagLine(input),
  ]);
}

// Mercari mirrors Depop but caps hashtags at three (Mercari surfaces only a few)
// and drops missing facts rather than printing placeholder dashes.
function formatMercari(input: ListingExportInput, fields: ResolvedFields): string {
  const facts = [
    input.brand ? `Brand: ${input.brand}` : null,
    `Size: ${input.size?.trim() ? input.size : "Not specified"}`,
    fields.conditionText ? `Condition: ${fields.conditionText}` : null,
    input.colorway ? `Color: ${input.colorway}` : null,
    fields.priceText ? `Price: ${fields.priceText}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return joinSections([
    input.description.trim() || null,
    facts,
    fields.flawSection,
    fields.measurementSection,
    hashtagLine(input, MERCARI_HASHTAG_MAX),
  ]);
}

// Vinted has no hashtag culture; keep the body plain (description, facts,
// measurements, flaws) and omit any fact Sello does not actually know.
function formatVinted(input: ListingExportInput, fields: ResolvedFields): string {
  const facts = [
    input.brand ? `Brand: ${input.brand}` : null,
    `Size: ${input.size?.trim() ? input.size : "Not specified"}`,
    fields.conditionText ? `Condition: ${fields.conditionText}` : null,
    input.colorway ? `Color: ${input.colorway}` : null,
    fields.priceText ? `Price: ${fields.priceText}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return joinSections([
    input.description.trim() || null,
    facts,
    fields.measurementSection,
    fields.flawSection,
  ]);
}

function formatPoshmark(input: ListingExportInput, fields: ResolvedFields): string {
  const facts = [
    `Brand: ${input.brand ?? "—"}`,
    `Size: ${input.size?.trim() || "Not specified"}`,
    `Condition: ${fields.conditionText ?? "—"}`,
    fields.priceText ? `Price: ${fields.priceText}` : null,
    input.colorway ? `Color: ${input.colorway}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const details = [
    "Details:",
    ...input.bulletPoints.filter((b) => b.trim()).map((b) => `• ${b.trim()}`),
  ];

  return joinSections([
    input.description.trim() || null,
    facts,
    fields.measurementSection,
    details.length > 1 ? details.join("\n") : null,
    fields.flawSection,
  ]);
}

function formatGrailed(input: ListingExportInput, fields: ResolvedFields): string {
  const facts = [
    `Brand: ${input.brand ?? "—"}`,
    input.size?.trim() ? `Tagged size: ${input.size}` : null,
    `Condition: ${fields.conditionText ?? "—"}`,
    fields.priceText ? `Price: ${fields.priceText}` : null,
    input.colorway ? `Color: ${input.colorway}` : null,
    input.styleCode ? `Style code: ${input.styleCode}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return joinSections([
    facts,
    input.description.trim() || null,
    fields.flawSection,
    fields.measurementSection,
  ]);
}

// Etsy search tags: descriptive multi-word phrases (not hashtags), capped at the
// Etsy maximum of 13 tags / 20 characters each. Built from the listing's own tags
// plus brand and category so there is always something useful to paste.
function etsyTags(input: ListingExportInput): string[] {
  const candidates = [
    ...input.tags,
    input.brand ?? "",
    input.category.replace(/_/g, " "),
    input.colorway ?? "",
  ];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const candidate of candidates) {
    const tag = candidate.trim().toLowerCase().slice(0, ETSY_TAG_CHAR_MAX).trim();
    if (tag.length < 2 || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= ETSY_TAG_MAX) break;
  }
  return tags;
}

// Etsy required fields Sello cannot determine for resale items. Surfaced as a
// "Needs seller review" block (and a warning) rather than pretending the draft is
// publish-ready — Etsy is a copy-ready draft channel, not a live integration.
const ETSY_SELLER_REVIEW = [
  "Needs seller review (Etsy requires these and Sello cannot set them automatically):",
  "- Listing type: who made it, what it is, and when it was made (handmade, vintage 20+ years, or a craft supply). Resale items are often none of these, so confirm Etsy eligibility before listing.",
  "- Shipping profile: processing time and shipping rates",
  "- Return and exchange policy",
  "- Shop section and the final Etsy category",
].join("\n");

const ETSY_PHOTO_CHECKLIST = [
  "Photo checklist:",
  "- Clear main photo on a clean, well-lit background",
  "- A scale or size reference shot",
  "- Every angle (front, back, sides, and sole or label)",
  "- Close-ups of any flaws",
  "- The brand label and size tag",
].join("\n");

function formatEtsy(input: ListingExportInput, fields: ResolvedFields): string {
  const facts = [
    input.brand ? `Brand: ${input.brand}` : null,
    `Size: ${input.size?.trim() || "Not specified"}`,
    fields.conditionText ? `Condition: ${fields.conditionText}` : null,
    input.colorway ? `Color: ${input.colorway}` : null,
    fields.priceText ? `Price: ${fields.priceText}` : null,
    "Quantity: 1",
  ]
    .filter(Boolean)
    .join("\n");

  const tags = etsyTags(input);
  const tagLine = tags.length > 0 ? `Tags: ${tags.join(", ")}` : null;

  return joinSections([
    input.description.trim() || null,
    facts,
    tagLine,
    fields.measurementSection,
    fields.flawSection,
    ETSY_PHOTO_CHECKLIST,
    ETSY_SELLER_REVIEW,
  ]);
}

// The structured tag value for each marketplace's Tags field, matching what that
// marketplace's body uses: Depop/Mercari get hashtags (at their own caps), Etsy
// gets its comma-separated search tags, everyone else gets the raw tag list.
function marketplaceTags(
  marketplace: ExportMarketplace,
  input: ListingExportInput,
): string {
  switch (marketplace) {
    case "depop":
      return hashtagLine(input);
    case "mercari":
      return hashtagLine(input, MERCARI_HASHTAG_MAX);
    case "etsy":
      return etsyTags(input).join(", ");
    default:
      return input.tags.map((t) => t.trim()).filter(Boolean).join(", ");
  }
}

// Field-level copy targets. Empty values are omitted, never fabricated, so the
// panel only offers a copy button for facts Sello actually has.
function buildFields(
  marketplace: ExportMarketplace,
  input: ListingExportInput,
  resolved: ResolvedFields,
  title: string,
  body: string,
): ExportField[] {
  const fields: ExportField[] = [];
  const push = (key: string, label: string, value: string | null): void => {
    if (value != null && value.trim() !== "") fields.push({ key, label, value });
  };

  push("title", "Title", title);
  push("description", "Description", body);
  push("price", "Price", resolved.priceText);
  push("brand", "Brand", input.brand);
  push("size", "Size", input.size?.trim() ? input.size.trim() : null);
  push("condition", "Condition", resolved.conditionText);
  push("color", "Color", input.colorway);
  push("style_code", "Style code", input.styleCode);
  push("tags", "Tags", marketplaceTags(marketplace, input));
  push("category", "Category", input.category.replace(/_/g, " "));

  return fields;
}

export function buildListingExport(
  marketplace: ExportMarketplace,
  input: ListingExportInput,
): ListingExport {
  const resolved = resolveFields(input);

  let title = resolved.title;
  let body: string;
  const warnings = [...resolved.warnings];
  switch (marketplace) {
    case "depop":
      body = formatDepop(input, resolved);
      break;
    case "poshmark":
      title = title.slice(0, POSHMARK_TITLE_MAX);
      body = formatPoshmark(input, resolved);
      break;
    case "grailed":
      body = formatGrailed(input, resolved);
      break;
    case "vinted":
      body = formatVinted(input, resolved);
      break;
    case "mercari":
      title = title.slice(0, MERCARI_TITLE_MAX);
      body = formatMercari(input, resolved);
      break;
    case "etsy":
      body = formatEtsy(input, resolved);
      warnings.push("Needs seller review for Etsy-specific fields");
      break;
  }

  const fields = buildFields(marketplace, input, resolved, title, body);

  return { marketplace, title, body, fields, warnings };
}
