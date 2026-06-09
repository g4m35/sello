// Pure copy/paste export formatting for marketplaces without a publish
// adapter. This produces text the seller pastes into the marketplace's own
// listing form — it never publishes anything.
import { z } from "zod";

import type { Flaw, Measurement } from "@/lib/ai/listing-draft";
import { conditionLabel, formatMoneyCents } from "@/lib/view/format";

export const ExportMarketplaceSchema = z.enum(["depop", "poshmark", "grailed"]);
export type ExportMarketplace = z.infer<typeof ExportMarketplaceSchema>;

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
};

export type ListingExport = {
  marketplace: ExportMarketplace;
  title: string;
  body: string;
  warnings: string[];
};

const POSHMARK_TITLE_MAX = 80;
const DEPOP_HASHTAG_MAX = 8;

// Categories where buyers expect garment measurements. Sneakers and
// accessories are sized by their tag alone.
const MEASURED_CATEGORIES = new Set(["streetwear", "hype_fashion", "other"]);

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

function hashtagLine(input: ListingExportInput): string {
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
    if (hashtags.length >= DEPOP_HASHTAG_MAX) break;
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
  if (measurement.value == null) return `${measurement.label}: [measure]`;
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

  let measurementSection: string | null = null;
  if (input.measurements.length > 0) {
    measurementSection = [
      "Measurements:",
      ...input.measurements.map(measurementLine),
    ].join("\n");
    if (!input.measurements.some((m) => m.value != null)) {
      warnings.push("Missing measurements (placeholders added)");
    }
  } else {
    const legacyMeasurements = matchSpecifics(
      input.itemSpecifics,
      MEASUREMENT_KEY_HINTS,
    ).filter(([key]) => !legacyFlaws.some(([flawKey]) => flawKey === key));

    if (legacyMeasurements.length > 0) {
      measurementSection = [
        "Measurements:",
        ...legacyMeasurements.map(([key, value]) => `${key}: ${value}`),
      ].join("\n");
    } else if (MEASURED_CATEGORIES.has(input.category)) {
      warnings.push("Missing measurements (placeholders added)");
      measurementSection = [
        "Measurements:",
        "Pit to pit: [measure]",
        "Length: [measure]",
      ].join("\n");
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

function formatPoshmark(input: ListingExportInput, fields: ResolvedFields): string {
  const facts = [
    `Brand: ${input.brand ?? "—"}`,
    `Size: ${input.size ?? "—"}`,
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
    `Tagged size: ${input.size ?? "—"}`,
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

export function buildListingExport(
  marketplace: ExportMarketplace,
  input: ListingExportInput,
): ListingExport {
  const fields = resolveFields(input);

  let title = fields.title;
  let body: string;
  switch (marketplace) {
    case "depop":
      body = formatDepop(input, fields);
      break;
    case "poshmark":
      title = title.slice(0, POSHMARK_TITLE_MAX);
      body = formatPoshmark(input, fields);
      break;
    case "grailed":
      body = formatGrailed(input, fields);
      break;
  }

  return { marketplace, title, body, warnings: fields.warnings };
}
