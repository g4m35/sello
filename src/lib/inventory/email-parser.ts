import type { EmailSignalType, Marketplace } from "@/generated/prisma/client";

// Pure, deterministic parser for inbound marketplace emails. NO network, NO DB,
// NO secrets. Given the raw email parts it guesses the marketplace, classifies
// the signal, extracts the obvious fields (title, price, order/listing URL,
// order/buyer id) and returns hints the ingest route uses to match a listing.
// Everything here is best-effort heuristics over text — it never throws and
// never trusts a single field alone for confidence.

export type ParseMarketplaceEmailInput = {
  sourceEmail: string;
  destinationEmail: string;
  subject: string;
  textBody: string;
  htmlBody?: string | null;
};

export type EmailMatchHints = {
  externalListingId?: string;
  externalUrl?: string;
};

export type EmailExtracted = {
  title?: string;
  priceCents?: number;
  url?: string;
  orderId?: string;
};

export type ParseMarketplaceEmailResult = {
  marketplaceGuess?: Marketplace;
  signalType: EmailSignalType;
  // 0..1. Bands: high >= 0.85, medium >= 0.5, low < 0.5. See sale-signal.ts.
  confidence: number;
  extracted: EmailExtracted;
  matchHints: EmailMatchHints;
};

// --- Marketplace detection ---------------------------------------------------

// Sender domains that identify a marketplace. A sender hit is the strongest
// marketplace signal; body/subject keywords are a weaker fallback.
const MARKETPLACE_DOMAINS: ReadonlyArray<[Marketplace, readonly string[]]> = [
  ["ebay", ["ebay.com", "ebay.co.uk", "reply.ebay.com", "ebay.ca"]],
  ["etsy", ["etsy.com", "mail.etsy.com", "convo.etsy.com"]],
  ["grailed", ["grailed.com", "mail.grailed.com"]],
  ["depop", ["depop.com", "mail.depop.com"]],
  ["poshmark", ["poshmark.com", "mail.poshmark.com"]],
  ["vinted", ["vinted.com", "vinted.co.uk", "mail.vinted.com"]],
  ["stockx", ["stockx.com", "mail.stockx.com"]],
  ["tiktok_shop", ["tiktok.com", "shop.tiktok.com", "tiktokglobalshop.com", "tiktok-shops.com"]],
];

// Keyword fallback when the sender domain is unknown (e.g. forwarded email).
const MARKETPLACE_KEYWORDS: ReadonlyArray<[Marketplace, readonly string[]]> = [
  ["ebay", ["ebay"]],
  ["etsy", ["etsy"]],
  ["grailed", ["grailed"]],
  ["depop", ["depop"]],
  ["poshmark", ["poshmark", "posh mark"]],
  ["vinted", ["vinted"]],
  ["stockx", ["stockx", "stock x"]],
  ["tiktok_shop", ["tiktok shop", "tiktok-shop", "tiktok"]],
];

function senderDomain(sourceEmail: string): string {
  const at = sourceEmail.lastIndexOf("@");
  return at >= 0 ? sourceEmail.slice(at + 1).trim().toLowerCase() : "";
}

function detectMarketplaceFromSender(sourceEmail: string): Marketplace | undefined {
  const domain = senderDomain(sourceEmail);
  if (!domain) return undefined;
  for (const [marketplace, domains] of MARKETPLACE_DOMAINS) {
    if (domains.some((d) => domain === d || domain.endsWith(`.${d}`))) {
      return marketplace;
    }
  }
  return undefined;
}

function detectMarketplaceFromText(haystack: string): Marketplace | undefined {
  for (const [marketplace, keywords] of MARKETPLACE_KEYWORDS) {
    if (keywords.some((k) => haystack.includes(k))) return marketplace;
  }
  return undefined;
}

// --- Signal classification ---------------------------------------------------

// Phrase tables ordered by precedence. The first table whose phrase matches wins
// the classification. Sale/payment/shipping phrases gate any engine action.
const SALE_PHRASES = [
  "you made a sale",
  "you have a sale",
  "your item sold",
  "your item has sold",
  "item sold",
  "it sold",
  "sold!",
  "sold on",
  "congratulations on your sale",
  "order received",
  "you have a new order",
  "new order",
  "you got an order",
  "you've sold",
  "you sold",
  "has been sold",
  "was purchased",
  "just bought",
  "purchased your",
];

const PAYMENT_PHRASES = [
  "payment received",
  "you received a payment",
  "you've been paid",
  "you have been paid",
  "funds have been sent",
  "payout sent",
  "money is on the way",
];

const SHIPPING_PHRASES = [
  "shipping label",
  "ship your item",
  "ship your order",
  "time to ship",
  "ready to ship",
  "print your label",
  "your label is ready",
  "please ship",
];

const OFFER_PHRASES = [
  "offer received",
  "you received an offer",
  "new offer",
  "made you an offer",
  "wants to buy",
  "sent you an offer",
  "counteroffer",
];

const LISTING_PUBLISHED_PHRASES = [
  "your listing is live",
  "listing is now live",
  "your item is listed",
  "successfully listed",
  "listing published",
  "now for sale",
  "is now live",
];

const LISTING_REMOVED_PHRASES = [
  "listing removed",
  "listing has ended",
  "your listing ended",
  "listing was removed",
  "item delisted",
  "listing expired",
  "has been taken down",
];

type Classification = { signalType: EmailSignalType; phraseHit: boolean };

function classify(haystack: string): Classification {
  if (SALE_PHRASES.some((p) => haystack.includes(p))) {
    return { signalType: "sale_detected", phraseHit: true };
  }
  if (PAYMENT_PHRASES.some((p) => haystack.includes(p))) {
    return { signalType: "payment_received", phraseHit: true };
  }
  if (SHIPPING_PHRASES.some((p) => haystack.includes(p))) {
    return { signalType: "shipping_needed", phraseHit: true };
  }
  if (OFFER_PHRASES.some((p) => haystack.includes(p))) {
    return { signalType: "offer_received", phraseHit: true };
  }
  if (LISTING_PUBLISHED_PHRASES.some((p) => haystack.includes(p))) {
    return { signalType: "listing_published", phraseHit: true };
  }
  if (LISTING_REMOVED_PHRASES.some((p) => haystack.includes(p))) {
    return { signalType: "listing_removed", phraseHit: true };
  }
  return { signalType: "unknown", phraseHit: false };
}

// Signals that, with a resolved user, may drive the safety engine downstream.
const ACTIONABLE_SIGNALS: ReadonlySet<EmailSignalType> = new Set<EmailSignalType>([
  "sale_detected",
  "payment_received",
  "shipping_needed",
]);

export function isActionableSignalType(signalType: EmailSignalType): boolean {
  return ACTIONABLE_SIGNALS.has(signalType);
}

// --- Extraction --------------------------------------------------------------

// Per-marketplace URL shapes that carry a listing/order. Matching one yields
// both the canonical url and (when present) an external listing id.
const LISTING_URL_PATTERNS: ReadonlyArray<{
  marketplace: Marketplace;
  pattern: RegExp;
  idGroup: number;
}> = [
  { marketplace: "ebay", pattern: /https?:\/\/[^\s"'<>]*ebay\.[a-z.]+\/itm\/(\d{6,})/i, idGroup: 1 },
  { marketplace: "etsy", pattern: /https?:\/\/[^\s"'<>]*etsy\.com\/listing\/(\d{6,})/i, idGroup: 1 },
  { marketplace: "grailed", pattern: /https?:\/\/[^\s"'<>]*grailed\.com\/listings\/(\d{4,})/i, idGroup: 1 },
  { marketplace: "depop", pattern: /https?:\/\/[^\s"'<>]*depop\.com\/products\/([\w-]+)/i, idGroup: 1 },
  { marketplace: "poshmark", pattern: /https?:\/\/[^\s"'<>]*poshmark\.com\/listing\/[\w-]*?-?([0-9a-f]{8,})/i, idGroup: 1 },
  { marketplace: "vinted", pattern: /https?:\/\/[^\s"'<>]*vinted\.[a-z.]+\/items\/(\d{4,})/i, idGroup: 1 },
  { marketplace: "stockx", pattern: /https?:\/\/[^\s"'<>]*stockx\.com\/([\w-]+)/i, idGroup: 1 },
  { marketplace: "tiktok_shop", pattern: /https?:\/\/[^\s"'<>]*tiktok\.com\/[^\s"'<>]*\/(\d{6,})/i, idGroup: 1 },
];

const GENERIC_URL_PATTERN = /https?:\/\/[^\s"'<>]+/i;

function extractListing(
  marketplace: Marketplace | undefined,
  haystack: string,
): { url?: string; externalListingId?: string } {
  if (marketplace) {
    const spec = LISTING_URL_PATTERNS.find((s) => s.marketplace === marketplace);
    if (spec) {
      const match = haystack.match(spec.pattern);
      if (match) {
        return {
          url: match[0],
          externalListingId: match[spec.idGroup] ?? undefined,
        };
      }
    }
  }
  const generic = haystack.match(GENERIC_URL_PATTERN);
  return generic ? { url: generic[0] } : {};
}

// Order/transaction ids vary by marketplace; capture the labelled forms.
const ORDER_ID_PATTERNS: readonly RegExp[] = [
  /order\s*(?:#|number|no\.?|id)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})/i,
  /transaction\s*(?:id|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})/i,
  /sale\s*(?:id|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{4,})/i,
];

function extractOrderId(haystack: string): string | undefined {
  for (const pattern of ORDER_ID_PATTERNS) {
    const match = haystack.match(pattern);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

// Money like $24.00, £1,299.99, 24,00 €, USD 240. Returns integer cents.
const PRICE_PATTERN =
  /(?:[$£€]|usd|gbp|eur)\s*([0-9][0-9.,]*)|([0-9][0-9.,]*)\s*(?:[$£€]|usd|gbp|eur)/i;

function extractPriceCents(haystack: string): number | undefined {
  const match = haystack.match(PRICE_PATTERN);
  const raw = match?.[1] ?? match?.[2];
  if (!raw) return undefined;
  const cents = parseMoneyToCents(raw);
  return cents !== undefined && cents > 0 ? cents : undefined;
}

// Normalizes "1,299.99" / "1.299,99" / "240" to integer cents.
function parseMoneyToCents(raw: string): number | undefined {
  let normalized = raw.trim();
  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");
  if (hasComma && hasDot) {
    // The rightmost separator is the decimal; strip the other (thousands).
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (hasComma) {
    // Treat "," as decimal only when it looks like cents (exactly 2 digits).
    normalized = /,\d{2}$/.test(normalized)
      ? normalized.replace(",", ".")
      : normalized.replace(/,/g, "");
  }
  const value = Number.parseFloat(normalized);
  if (!Number.isFinite(value)) return undefined;
  return Math.round(value * 100);
}

// Title: prefer quoted text in the subject (most marketplaces quote the item),
// else strip a known lead-in phrase, else fall back to the cleaned subject.
const SUBJECT_LEADINS: readonly RegExp[] = [
  /^.*?\byou (?:made a sale|sold|have sold|got an order)[:\s-]*/i,
  /^.*?\bsold[:\s-]+/i,
  /^.*?\border (?:received|confirmed)[:\s-]*/i,
  /^.*?\bpayment received[:\s-]*/i,
  /^.*?\btime to ship[:\s-]*/i,
];

function extractTitle(subject: string): string | undefined {
  const quoted = subject.match(/["“”']([^"“”']{3,})["“”']/);
  if (quoted?.[1]) return quoted[1].trim();

  for (const leadIn of SUBJECT_LEADINS) {
    if (leadIn.test(subject)) {
      const stripped = subject.replace(leadIn, "").trim();
      if (stripped.length >= 3) return cleanTitle(stripped);
    }
  }

  const cleaned = cleanTitle(subject);
  return cleaned.length >= 3 ? cleaned : undefined;
}

function cleanTitle(value: string): string {
  return value
    .replace(/^(re|fwd):\s*/i, "")
    .replace(/[\s\-–—:|]+$/g, "")
    .trim();
}

// --- Confidence --------------------------------------------------------------

const SALE_LIKE: ReadonlySet<EmailSignalType> = new Set<EmailSignalType>([
  "sale_detected",
  "payment_received",
  "shipping_needed",
]);

// high   (>=0.85): known sender + sale-like phrase + exact match (listing id or url)
// medium (>=0.5):  known sender + sale-like phrase + strong title
// low    (<0.5):   a sale-like phrase but a weak/no marketplace+match
function scoreConfidence(input: {
  senderKnown: boolean;
  saleLike: boolean;
  hasExactMatch: boolean;
  hasStrongTitle: boolean;
}): number {
  if (!input.saleLike) return 0.1;
  if (input.senderKnown && input.hasExactMatch) return 0.9;
  if (input.senderKnown && input.hasStrongTitle) return 0.6;
  if (input.senderKnown) return 0.45;
  if (input.hasExactMatch) return 0.4;
  return 0.25;
}

// --- Entry point -------------------------------------------------------------

export function parseMarketplaceEmail(
  input: ParseMarketplaceEmailInput,
): ParseMarketplaceEmailResult {
  const subject = input.subject ?? "";
  // htmlBody is included so marketplaces that only carry the listing URL in the
  // HTML part still match; it is treated as plain text for keyword/URL scans.
  const bodyText = [input.textBody ?? "", input.htmlBody ?? ""].join("\n");
  const haystack = `${subject}\n${bodyText}`.toLowerCase();

  const senderMarketplace = detectMarketplaceFromSender(input.sourceEmail);
  const marketplaceGuess =
    senderMarketplace ?? detectMarketplaceFromText(haystack);
  const senderKnown = senderMarketplace !== undefined;

  const { signalType, phraseHit } = classify(haystack);
  const saleLike = phraseHit && SALE_LIKE.has(signalType);

  const listing = extractListing(marketplaceGuess, `${subject}\n${bodyText}`);
  const orderId = extractOrderId(`${subject}\n${bodyText}`);
  const priceCents = extractPriceCents(`${subject}\n${bodyText}`);
  const title = extractTitle(subject);

  const externalListingId = listing.externalListingId;
  const externalUrl = listing.url;
  const hasExactMatch = Boolean(externalListingId || externalUrl);
  const hasStrongTitle = Boolean(title && title.length >= 6);

  const confidence = phraseHit
    ? scoreConfidence({ senderKnown, saleLike, hasExactMatch, hasStrongTitle })
    : 0.1;

  const extracted: EmailExtracted = {};
  if (title) extracted.title = title;
  if (priceCents !== undefined) extracted.priceCents = priceCents;
  if (externalUrl) extracted.url = externalUrl;
  if (orderId) extracted.orderId = orderId;

  const matchHints: EmailMatchHints = {};
  if (externalListingId) matchHints.externalListingId = externalListingId;
  if (externalUrl) matchHints.externalUrl = externalUrl;

  return {
    marketplaceGuess,
    signalType,
    confidence,
    extracted,
    matchHints,
  };
}
