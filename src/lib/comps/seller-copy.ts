// Seller-facing pricing copy. Normal sellers should never see raw provider ids
// (e.g. "apify-ebay-sold") or internal skip-reason codes (e.g.
// "global_budget_exceeded"). These pure helpers translate the internal comps
// discovery state into safe, plain-language labels and notes for the UI.

export type CompSkip = { source: string; message: string };

const SOLD_SOURCE_LABEL = "Fresh sold comps";
const ACTIVE_SOURCE_LABEL = "Active market listings";
const VISUAL_SOURCE_LABEL = "Visual match search";
const GENERIC_SOURCE_LABEL = "Market data";

/** Map one internal source id to a seller-friendly category. */
export function friendlySourceLabel(id: string): string {
  const lower = id.toLowerCase();
  if (lower.includes("lens") || lower.includes("visual")) return VISUAL_SOURCE_LABEL;
  if (lower.includes("active") || lower.includes("browse")) return ACTIVE_SOURCE_LABEL;
  if (lower.includes("sold") || lower.includes("insights") || lower.includes("stockx")) {
    return SOLD_SOURCE_LABEL;
  }
  return GENERIC_SOURCE_LABEL;
}

/** Deduped, seller-friendly source categories. Never returns raw provider ids. */
export function friendlySourceLabels(ids: string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const label = friendlySourceLabel(id);
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

/** Preserve seller-entered source names while hiding automatic provider ids. */
export function sellerSafeCompRows<T extends { source: string }>(rows: T[]): T[] {
  return rows.map((row) => ({
    ...row,
    source: row.source.startsWith("auto:")
      ? friendlySourceLabel(row.source)
      : row.source,
  }));
}

const MANUAL_STILL_WORKS = "Manual comps still work.";
const GENERIC_SOURCE_ERROR = "A pricing source was temporarily unavailable. Try again later.";

function noteForSkip(message: string): string | null {
  const m = message.toLowerCase();
  if (m.includes("identity")) {
    return "Add a more specific brand, exact product name, or model so we can find sold comps.";
  }
  if (m.includes("budget")) {
    return `Fresh sold comps are paused for now (daily limit reached). ${MANUAL_STILL_WORKS}`;
  }
  if (m.includes("quota") || m.includes("daily_provider") || m.includes("monthly")) {
    return `You've reached your sold-comp refresh limit for now. ${MANUAL_STILL_WORKS}`;
  }
  if (m.includes("cooldown")) {
    return "Sold comps were just refreshed. Try again shortly.";
  }
  if (m.includes("paid_providers_disabled") || m.includes("paid comp provider")) {
    return `Fresh sold comps are disabled right now. ${MANUAL_STILL_WORKS}`;
  }
  if (m.includes("fail") || m.includes("error") || m.includes("unavailable")) {
    return "A pricing source was temporarily unavailable. Try again later.";
  }
  return null;
}

/** Convert persisted provider diagnostics into a safe response for seller-facing APIs. */
export function sellerSafeSourceErrors(value: unknown): CompSkip[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const source = "source" in entry && typeof entry.source === "string"
      ? entry.source
      : "unknown";
    const message = "message" in entry && typeof entry.message === "string"
      ? entry.message
      : "";
    return [{
      source: source === "sello" ? "Sello" : friendlySourceLabel(source),
      message: noteForSkip(message) ?? GENERIC_SOURCE_ERROR,
    }];
  });
}

export type PricingNotesInput = {
  autoDiscoveryEnabled: boolean;
  /** Kill switch for paid sold-comp providers. Undefined = unknown (treated as on). */
  paidProvidersEnabled?: boolean;
  status: string;
  sourceErrors: CompSkip[];
};

/**
 * Seller-facing "why comps were skipped / what to fix" notes. Always safe to
 * render: never includes raw provider ids or internal reason codes.
 */
export function buildPricingNotes(input: PricingNotesInput): string[] {
  const notes: string[] = [];
  const add = (note: string) => {
    if (!notes.includes(note)) notes.push(note);
  };

  if (input.paidProvidersEnabled === false) {
    add(`Fresh sold comps are disabled right now. ${MANUAL_STILL_WORKS}`);
  } else if (!input.autoDiscoveryEnabled) {
    add(
      "Automatic background pricing is off. Use Refresh comps to search fresh sold comps for this listing.",
    );
  }

  if (input.status === "skipped_weak_identity") {
    add("Add a more specific brand, exact product name, or model so we can find sold comps.");
  }

  let sawUnmapped = false;
  for (const err of input.sourceErrors) {
    const note = noteForSkip(err.message);
    if (note) add(note);
    else sawUnmapped = true;
  }
  if (sawUnmapped && notes.length === 0) {
    add(`Some pricing sources were skipped. ${MANUAL_STILL_WORKS}`);
  }

  return notes;
}
